//! The Host's Torrent engine, as the Host reaches it: the bundled Go program of
//! `engine/`, started on the first torrent played and spoken to in JSON lines over
//! stdio (ADR-0042 §1).
//!
//! [`ProcessTorrentEngine`] implements the seam `host-core` defines
//! ([`TorrentEngine`](host_core::TorrentEngine)), and nothing here names more of
//! `host-core` than that seam's own types. Like the Player and the transport it
//! lives outside the Host's vocabulary because it reaches outside the process;
//! unlike them it needs neither `tokio` nor `unsafe` code: the engine serves over
//! a loopback URL, so this crate is a child process, three threads and a pipe.
//!
//! - [`codec`]: the protocol, both directions, with no process in sight.
//! - [`ProcessTorrentEngine`]: the child, its answers and its reports.
//! - [`launch`]: where the engine's binary is, where its torrents are, and the
//!   startup wipe of what a Host that was killed left behind.

pub mod codec;
mod engine;
pub mod launch;

pub use engine::{Launch, ProcessTorrentEngine, SERVE_ANSWER_BOUND};
