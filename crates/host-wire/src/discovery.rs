//! Finding the Host on the network.
//!
//! A Host announces itself over mDNS so that a client which speaks it can find
//! the address without being told; manual `host:port` is the fallback for
//! everything that does not, and it is the fallback that must work first — mDNS
//! is the least reliable part of pairing, and nothing about connecting depends on
//! it (#31).
//!
//! The announcement is a seam, like the store and the player: the real one talks
//! to the network, and a Host built without one is the default the tests and a
//! machine with no multicast get.

use std::collections::HashMap;

use mdns_sd::{ServiceDaemon, ServiceInfo};

/// The service type a Host advertises itself as. A browser lists what answers
/// under this, and the instance name distinguishes two Hosts on one LAN.
pub const SERVICE_TYPE: &str = "_streamingapp._tcp.local.";

/// The TXT record key carrying the protocol version, so a discovery browser can
/// tell whether the Host speaks its version before it connects.
const VERSION_KEY: &str = "version";

/// The name a Host advertises under: the owner's label with the mDNS suffix that
/// says it is a local name.
pub fn host_name(label: &str) -> String {
    format!("{label}.local.")
}

/// Announcing this Host on the network.
pub trait Discovery: Send + Sync + 'static {
    /// Announce `name` at `address:port`, and keep announcing until the returned
    /// handle is dropped.
    fn advertise(
        &self,
        name: &str,
        address: &str,
        port: u16,
    ) -> Result<Advertisement, DiscoveryError>;
}

/// A Host that says nothing on the network: what a test and a machine with mDNS
/// turned off get. Manual `host:port` is unaffected, which is the point.
#[derive(Debug, Default)]
pub struct NoDiscovery;

impl Discovery for NoDiscovery {
    fn advertise(
        &self,
        _name: &str,
        _address: &str,
        _port: u16,
    ) -> Result<Advertisement, DiscoveryError> {
        Ok(Advertisement { _daemon: None })
    }
}

/// The real thing: a Host that answers mDNS.
#[derive(Debug, Default)]
pub struct Mdns;

impl Discovery for Mdns {
    fn advertise(
        &self,
        name: &str,
        address: &str,
        port: u16,
    ) -> Result<Advertisement, DiscoveryError> {
        let daemon = ServiceDaemon::new().map_err(DiscoveryError::new)?;

        let properties: HashMap<String, String> =
            HashMap::from([(VERSION_KEY.to_owned(), env!("CARGO_PKG_VERSION").to_owned())]);
        let service = ServiceInfo::new(
            SERVICE_TYPE,
            name,
            &host_name(name),
            address,
            port,
            properties,
        )
        .map_err(DiscoveryError::new)?;

        daemon.register(service).map_err(DiscoveryError::new)?;

        Ok(Advertisement {
            _daemon: Some(daemon),
        })
    }
}

/// The handle that keeps a Host announced. Dropping it stops the announcement —
/// the daemon goes with it, and with it the record.
pub struct Advertisement {
    _daemon: Option<ServiceDaemon>,
}

/// A Host that could not announce itself, in the platform's own words. Not fatal:
/// the wire server still answers, and manual `host:port` still works.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("the Host could not announce itself: {detail}")]
pub struct DiscoveryError {
    detail: String,
}

impl DiscoveryError {
    fn new(error: impl std::fmt::Display) -> Self {
        Self {
            detail: error.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_host_advertises_under_a_service_type_and_a_local_name() {
        assert_eq!(SERVICE_TYPE, "_streamingapp._tcp.local.");
        assert_eq!(host_name("living-room"), "living-room.local.");
    }

    #[test]
    fn a_host_with_no_discovery_still_has_a_handle_to_hold() {
        // The point of the no-op: a machine that cannot announce itself is not a
        // Host that cannot serve, so the caller's shape does not change.
        let announcement = NoDiscovery
            .advertise("living-room", "192.168.1.9", 8090)
            .expect("a Host that says nothing still says ok");
        drop(announcement);
    }
}
