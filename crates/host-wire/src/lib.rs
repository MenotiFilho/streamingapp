//! The Host's wire server: the one Action surface, reached from another device.
//!
//! A **remote client** is the Host's window's equal: it reaches the same Action
//! surface through a versioned WebSocket, is judged by a **device token** rather
//! than by being the Host's own process, and is told the same **Snapshots**. What
//! is here is the transport and the pairing that lets a device in; the surface
//! itself — and the codec that spells it — live in [`host_core`], because they
//! are the Host's vocabulary and this crate only moves them over a socket
//! (ADR-0002, ADR-0008).
//!
//! ```
//! use std::net::SocketAddr;
//!
//! use host_core::{Action, DeviceToken, Response, Snapshot};
//! use host_wire::{Broadcast, Server, Surface};
//!
//! // The app shell's implementation; a test's is the same three methods over a
//! // real `Host`.
//! struct Echo;
//! impl Surface for Echo {
//!     fn dispatch(&self, _action: Action) -> Result<Response, host_core::ActionError> {
//!         unimplemented!("the shell's implementation drives the Host")
//!     }
//!     fn device(&self, _token: &DeviceToken) -> Option<host_core::DeviceSummary> { None }
//!     fn snapshot(&self) -> Snapshot { unimplemented!("the shell's implementation reads the Host") }
//! }
//!
//! let broadcast = Broadcast::new();
//! let server = Server::start(
//!     std::sync::Arc::new(Echo),
//!     broadcast,
//!     "127.0.0.1:0".parse::<SocketAddr>()?,
//! )?;
//! assert_ne!(server.address().port(), 0);
//! # Ok::<(), Box<dyn std::error::Error>>(())
//! ```

mod discovery;
mod http;
mod remote;
mod remote_page;
mod server;

pub use discovery::{
    host_name, service, Advertisement, Discovery, DiscoveryError, Mdns, NoDiscovery, SERVICE_TYPE,
};
pub use server::{Broadcast, Server, Subscription, Surface, DEFAULT_PORT};
