//! Where the Host answers remote clients: the wire server's corner of the shell.
//!
//! The rules live in `host-wire` and the Host; what is here is the facts about
//! this machine — which port is free, which address the LAN knows this machine
//! by, and what to call it in an mDNS announcement. None of it decides anything a
//! client can see beyond the address it publishes.

use std::net::{IpAddr, Ipv4Addr, SocketAddr, UdpSocket};

use host_wire::{Advertisement, Broadcast, Discovery, Mdns, Server, DEFAULT_PORT};

use crate::ipc::WireSurface;

/// The wire server, running: the address it landed on, and the announcement
/// keeping it discoverable.
pub struct Serving {
    pub server: Server,
    /// `None` where mDNS could not be spoken — a machine with no multicast, or a
    /// platform that refused. Manual `host:port` is what the owner uses then, and
    /// it must work first (#31).
    pub advertisement: Option<Advertisement>,
    /// `host:port`, as the window reads it out.
    pub address: String,
}

/// Start the wire server, and work out the address to tell the Host.
pub fn start(app: &tauri::AppHandle, broadcast: Broadcast) -> Result<Serving, std::io::Error> {
    let surface = WireSurface::new(app.clone());

    // The preferred port first, then whatever the operating system offers: a
    // number worth remembering is worth trying to keep, and a Host that cannot
    // have it is not a Host that cannot serve.
    let on = |port| SocketAddr::from((Ipv4Addr::UNSPECIFIED, port));
    let server = match Server::start(surface.clone(), broadcast.clone(), on(DEFAULT_PORT)) {
        Ok(server) => server,
        Err(error) => {
            tracing::warn!(
                %error,
                port = DEFAULT_PORT,
                "the preferred port is taken; letting the operating system choose one",
            );
            Server::start(surface, broadcast, on(0))?
        }
    };

    let port = server.address().port();
    let ip = lan_ip();
    let address = match ip {
        Some(ip) => format!("{ip}:{port}"),
        // No interface to name: the Host still serves, and the address a person
        // reads is the wildcard one to be replaced with whatever their machine is.
        None => format!("0.0.0.0:{port}"),
    };

    let advertisement = ip.and_then(|ip| match Mdns.advertise(&label(), &ip.to_string(), port) {
        Ok(advertisement) => {
            tracing::info!(
                service = host_wire::SERVICE_TYPE,
                %ip,
                port,
                "the Host announces itself on the network",
            );
            Some(advertisement)
        }
        // Not fatal, and said in the log rather than shown: everything still
        // works by address.
        Err(error) => {
            tracing::warn!(%error, "the Host could not announce itself; use host:port");
            None
        }
    });

    Ok(Serving {
        server,
        advertisement,
        address,
    })
}

/// The address this machine is known by on its LAN, if it has one.
///
/// Found by asking the operating system which local address a packet to a
/// documentation address would leave from — no packet is sent, and the answer is
/// the interface that would carry it, which is the one another device will
/// reach.
fn lan_ip() -> Option<IpAddr> {
    let socket = UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0)).ok()?;
    // TEST-NET-1 (RFC 5737): routed nowhere on purpose, so this only ever asks
    // the routing table a question.
    socket.connect((Ipv4Addr::new(192, 0, 2, 1), 80)).ok()?;
    let ip = socket.local_addr().ok()?.ip();
    (!ip.is_unspecified()).then_some(ip)
}

/// What this machine calls itself on the network: its own name where the platform
/// offers one, and something serviceable where it does not.
fn label() -> String {
    let raw = std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| "streamingapp".to_owned());
    label_of(&raw)
}

/// The same, from a name: a DNS-SD instance name is mostly free, but a name that
/// looks like a host name avoids asking every browser to guess — letters, digits
/// and hyphens, with runs of anything else collapsed to one hyphen.
///
/// Pure, so what the Host will call itself is a thing a test can hold.
fn label_of(raw: &str) -> String {
    let mut label = String::with_capacity(raw.len());
    for c in raw.chars() {
        let squashed = if c.is_ascii_alphanumeric() { c } else { '-' };
        if squashed == '-' && label.ends_with('-') {
            continue;
        }
        label.push(squashed);
    }
    let label = label.trim_matches('-');

    if label.is_empty() {
        "streamingapp".to_owned()
    } else {
        label.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_machine_name_becomes_a_usable_network_label() {
        assert_eq!(label_of("living-room"), "living-room");
        assert_eq!(label_of("DESKTOP-4K7Q2M"), "DESKTOP-4K7Q2M");
        assert_eq!(
            label_of("Menoti's laptop (work)"),
            "Menoti-s-laptop-work",
            "a name a browser would have to guess at is squashed into one it will not"
        );
        assert_eq!(label_of("  ---  "), "streamingapp");
        assert_eq!(label_of(""), "streamingapp");
    }
}
