//! The Host's one HTTP client.
//!
//! Everything that reaches an Addon over the network goes through
//! [`host_core::Fetcher`], and this is the implementation the real Host is built
//! with. It lives outside `host-core` on purpose: the Host's vocabulary and its
//! decisions know nothing about HTTP, and this knows nothing about Addons beyond
//! fetching a URL.
//!
//! Blocking on purpose. The Action surface is a door one client goes through at a
//! time, a manifest fetch happens when the owner asks for one, and the alternatives
//! (an async trait, an executor inside `host-core`) would put a runtime under every
//! test in the repository to serve a handful of requests (ADR-0009).

use std::time::Duration;

use host_core::{FetchError, Fetcher};
use ureq::tls::{TlsConfig, TlsProvider};

/// The most of an answer the Host will read. A manifest is kilobytes; anything
/// larger is an Addon misbehaving or lying.
const MAX_BODY_BYTES: u64 = 4 * 1024 * 1024;

/// How long a fetch may take, end to end — connect, send, receive.
const TIMEOUT: Duration = Duration::from_secs(30);

/// The Host's [`Fetcher`], over HTTP.
pub struct HttpFetcher {
    agent: ureq::Agent,
}

impl HttpFetcher {
    pub fn new() -> Self {
        // The platform's own TLS: schannel on Windows, OpenSSL elsewhere. It is
        // chosen by name rather than left to the default, because ureq's default
        // is Rustls — which this build does not compile — and a request to an
        // `https` URL would then fail at the first fetch rather than at build
        // time.
        let tls = TlsConfig::builder()
            .provider(TlsProvider::NativeTls)
            .build();
        let config = ureq::Agent::config_builder()
            .timeout_global(Some(TIMEOUT))
            .tls_config(tls)
            .build();

        Self {
            agent: ureq::Agent::new_with_config(config),
        }
    }
}

impl Default for HttpFetcher {
    fn default() -> Self {
        Self::new()
    }
}

impl Fetcher for HttpFetcher {
    fn fetch(&self, url: &str) -> Result<String, FetchError> {
        let response = self.agent.get(url).call().map_err(unreachable)?;

        response
            .into_body()
            .into_with_config()
            .limit(MAX_BODY_BYTES)
            .read_to_string()
            .map_err(|error| FetchError::Body {
                detail: error.to_string(),
            })
    }
}

/// An Addon answering, or not answering at all.
///
/// A status is carried as the number it was: it is a fact about the Addon, and a
/// number is what a person can act on. Everything else is a failure to get an
/// answer, and its message is the client library's, kept for the diagnosis.
fn unreachable(error: ureq::Error) -> FetchError {
    match error {
        ureq::Error::StatusCode(status) => FetchError::Status { status },
        other => FetchError::Unreachable {
            detail: other.to_string(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_agent_is_configured_to_use_the_platforms_tls() {
        let fetcher = HttpFetcher::new();

        assert_eq!(
            fetcher.agent.config().tls_config().provider(),
            TlsProvider::NativeTls,
            "the default provider is one this build does not compile, and a \
             request would fail on it at the first fetch"
        );
    }

    #[test]
    fn an_answered_status_is_reported_as_that_status() {
        assert_eq!(
            unreachable(ureq::Error::StatusCode(404)),
            FetchError::Status { status: 404 }
        );
        assert_eq!(
            unreachable(ureq::Error::StatusCode(503)),
            FetchError::Status { status: 503 }
        );
    }

    #[test]
    fn an_answer_that_never_came_is_reported_as_unreachable() {
        for error in [
            ureq::Error::HostNotFound,
            ureq::Error::ConnectionFailed,
            ureq::Error::TlsRequired,
        ] {
            let reported = unreachable(error);

            assert!(
                matches!(reported, FetchError::Unreachable { .. }),
                "a failure to get an answer is not a status: {reported:?}"
            );
        }
    }
}
