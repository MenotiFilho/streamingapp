//! The Host's logs: one JSON object per line, on disk, in the data directory.
//!
//! Kept out of the app shell so that the format is testable without a window, and
//! so that the startup path in `src-tauri/` stays a matter of wiring.

use std::io;
use std::io::Write;
use std::path::{Path, PathBuf};

use tracing_appender::non_blocking::{NonBlocking, WorkerGuard};
use tracing_subscriber::fmt::MakeWriter;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, Registry};

/// The file the Host's logs go to, inside the data directory.
pub const LOG_FILE: &str = "host.log";

/// The level the Host logs at when `RUST_LOG` says nothing.
const DEFAULT_LEVEL: &str = "info";

/// What [`init`] hands back.
///
/// Hold on to it for as long as the Host runs: dropping it stops the writer, and a
/// log written after that is a log lost.
pub struct Logs {
    /// Never read — holding it is the point. Dropping it is what shuts the writer
    /// down once and for all.
    _guard: WorkerGuard,
    writer: NonBlocking,
    path: PathBuf,
}

impl Logs {
    /// The file the logs are going to.
    pub fn path(&self) -> &Path {
        &self.path
    }

    /// Wait for everything written so far to reach the file.
    ///
    /// Best-effort on purpose: the writer is on its way out either way, and a Host
    /// that could not flush its last lines has nothing useful left to do with that.
    pub fn flush(&mut self) {
        let _ = self.writer.flush();
    }
}

impl Drop for Logs {
    fn drop(&mut self) {
        self.flush();
    }
}

/// Start logging to `data_dir/host.log`.
///
/// Fails rather than quietly falling back to silence: a Host that cannot write its
/// logs should say so at startup instead of losing the record.
pub fn init(data_dir: &Path) -> Result<Logs, LoggingError> {
    std::fs::create_dir_all(data_dir).map_err(|source| LoggingError::Directory {
        path: data_dir.to_owned(),
        source,
    })?;

    let appender = tracing_appender::rolling::never(data_dir, LOG_FILE);
    let (writer, guard) = tracing_appender::non_blocking(appender);

    subscriber(writer.clone())
        .try_init()
        .map_err(|error| LoggingError::AlreadySet {
            detail: error.to_string(),
        })?;

    Ok(Logs {
        _guard: guard,
        writer,
        path: data_dir.join(LOG_FILE),
    })
}

/// The Host's subscriber, writing JSON lines to `writer`.
///
/// Separate from [`init`] so that a test can drive the real format without
/// installing a process-wide subscriber.
pub fn subscriber<W>(writer: W) -> impl tracing::Subscriber + Send + Sync + 'static
where
    W: for<'w> MakeWriter<'w> + Send + Sync + 'static,
{
    Registry::default().with(level()).with(
        tracing_subscriber::fmt::layer()
            .json()
            .flatten_event(true)
            .with_ansi(false)
            .with_current_span(false)
            .with_span_list(false)
            .with_writer(writer),
    )
}

fn level() -> EnvFilter {
    EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new(DEFAULT_LEVEL))
}

/// Logging could not be started.
#[derive(Debug, thiserror::Error)]
pub enum LoggingError {
    #[error("a global subscriber is already installed: {detail}")]
    AlreadySet { detail: String },

    #[error("the log directory {path} is not usable: {source}")]
    Directory {
        path: PathBuf,
        #[source]
        source: io::Error,
    },
}
