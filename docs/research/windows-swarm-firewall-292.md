# What Windows does when the Host first talks to peers

**Date of research:** 2026-11-16. **Where:** primary sources only — Microsoft Learn documentation on Windows Defender Firewall and Windows Filtering Platform (WFP) Application Layer Enforcement (ALE), BitTorrent Enhancement Proposals (BEPs), candidate torrent engine source trees (`librqbit`, `libtorrent`, `anacrolix/torrent`, `TorrServer`, `stremio-service`), Tauri v2's NSIS template, and this repository's build, installer, and `host-wire` code. This note states facts and what the engine choice (#293) and the streaming specification must account for; it makes no decisions.

Issue [#292](https://github.com/MenotiFilho/streamingapp/issues/292), child of map [#283](https://github.com/MenotiFilho/streamingapp/issues/283). Read with `CONTEXT.md` (*Host*, *Remote client*, *Player*, *Provider*, *Stream*) and sibling engine survey [#290](https://github.com/MenotiFilho/streamingapp/issues/290).

---

## Sources, and what each one grounds

| Source | URL / Path | What it grounds |
|---|---|---|
| Microsoft Learn — *Windows Firewall Rules* | <https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules> | Inbound default block, rule precedence, prompt vs. admin/standard user block-rule creation, full-path rule requirement, `AllowLocalPolicyMerge` |
| Microsoft Learn — *Manage Windows Firewall With the Command Line* | <https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line> | Default profile policy (`DefaultInboundAction Block`, `DefaultOutboundAction Allow`, `NotifyOnListen` / `inboundusernotification`), `netsh advfirewall` |
| Microsoft Learn — *ALE Layers* | <https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers> | Exact WFP inspection points for `connect()`, `bind()`, `listen()`, `accept()`, and UDP receive |
| Microsoft Learn — *ALE Stateful Filtering* | <https://learn.microsoft.com/en-us/windows/win32/fwp/ale-stateful-filtering> | Stateful return-packet allowance for outbound TCP and **60-second** UDP unicast flows |
| Microsoft Learn — *ALE Multicast/Broadcast Traffic* | <https://learn.microsoft.com/en-us/windows/win32/fwp/ale-multicast-broadcast-traffic> | **4-second** return-traffic window created by outbound multicast/broadcast (SSDP `M-SEARCH`) |
| Microsoft Learn — *Event 5152* / *Filter Origin* | <https://learn.microsoft.com/en-us/windows/security/threat-protection/auditing/event-5152> | WFP *Query User default* / *Block query user* filter origin on inbound drops |
| Tauri v2 — *Windows Installer* & `installer.nsi` | <https://v2.tauri.app/distribute/windows-installer/>, <https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi> | `currentUser` (`RequestExecutionLevel user`, `$LOCALAPPDATA`) vs. `perMachine` / `both`, and `installerHooks` |
| BitTorrent — BEP 3, BEP 5, BEP 55 | <https://www.bittorrent.org/beps/bep_0003.html>, <https://www.bittorrent.org/beps/bep_0005.html>, <https://www.bittorrent.org/beps/bep_0055.html> | Bidirectional peer wire over outbound connections, unfirewalled DHT refresh/responder behavior, `ut_holepunch` |
| `libtorrent` (`RC_2_0`) | <https://libtorrent.org/reference-Settings.html>, [`src/upnp.cpp`](https://raw.githubusercontent.com/arvidn/libtorrent/RC_2_0/src/upnp.cpp), [`src/natpmp.cpp`](https://raw.githubusercontent.com/arvidn/libtorrent/RC_2_0/src/natpmp.cpp) | `listen_interfaces` warning, `enable_incoming_tcp`/`utp`, `seeding_outgoing_connections`, SSDP port 1900 listener, NAT-PMP/PCP UDP 5351 |
| `librqbit` (`ikatson/rqbit`) | [`session.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit/src/session.rs), [`listen.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit/src/listen.rs), [`dht.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/dht/src/dht.rs), [`upnp/lib.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/upnp/src/lib.rs), [`librqbit_lsd/lib.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit_lsd/src/lib.rs) | Default `listen: None`, default DHT UDP bind + `WSA*` handling, default LSD UDP `6771` bind, ephemeral SSDP + TCP-only UPnP mapping |
| `anacrolix/torrent` & `TorrServer` | [`config.go`](https://raw.githubusercontent.com/anacrolix/torrent/master/config.go), [`upnp.go`](https://raw.githubusercontent.com/anacrolix/upnp/master/upnp.go), [`btserver.go`](https://raw.githubusercontent.com/YouROK/TorrServer/master/server/torr/btserver.go), [`cmd/main.go`](https://raw.githubusercontent.com/YouROK/TorrServer/master/server/cmd/main.go) | Shared uTP/DHT UDP socket, UPnP multicast discovery, HTTP vs. torrent bind defaults |
| `Stremio/stremio-service` | [`StremioService.iss`](https://raw.githubusercontent.com/Stremio/stremio-service/master/setup/StremioService.iss), [`src/server.rs`](https://raw.githubusercontent.com/Stremio/stremio-service/master/src/server.rs) | Sidecar process spawning (`stremio-runtime.exe server.js`) and `PrivilegesRequired=lowest` without installer firewall rules |
| `mdns-sd` (`0.21.5` in `Cargo.lock`) | [`service_daemon.rs`](https://raw.githubusercontent.com/keepsimple1/mdns-sd/main/src/service_daemon.rs) | UDP port `5353` multicast sockets bound by the Host's existing mDNS advertiser |
| This repository | `scripts/cd.sh`, `scripts/windows/build.ps1`, `scripts/windows/README.md`, `scripts/windows/verify.ps1`, `src-tauri/tauri.conf.json`, `src-tauri/tauri.windows.conf.json`, `src-tauri/src/wire.rs`, `crates/host-wire/src/server.rs`, `crates/host-wire/src/discovery.rs`, `docs/agents/ci.md` | Current NSIS bundle configuration, unsigned artifact status, and existing `host-wire` LAN listener baseline |

---

## 1. When Windows Defender Firewall prompts

Out of the box on Windows 10 and Windows 11, Windows Defender Firewall applies `DefaultOutboundAction = Allow`, `DefaultInboundAction = Block`, and `NotifyOnListen = True` (`inboundusernotification enable`) across Domain, Private, and Public profiles ([Microsoft Learn — Command Line](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/configure-with-command-line), [Microsoft Learn — Firewall Rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)). Packet inspection happens in the Windows Filtering Platform (WFP) at Application Layer Enforcement (ALE) layers ([ALE Layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers)):

### 1.1 Outbound-only connections

- **TCP `connect()` and outbound UDP `sendto()`/`connect()`** are authorized at `FWPM_LAYER_ALE_AUTH_CONNECT_V4`/`V6` ([ALE Layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers)). Under default Windows settings (`DefaultOutboundAction = Allow`), **no firewall prompt is shown**.
- **Stateful return traffic is permitted automatically without an inbound rule:**
  - For outbound **TCP**, ALE maintains a flow for the lifetime of the connected socket.
  - For outbound **UDP unicast**, ALE creates a stateful flow for the exact `(localIP, localPort, remoteIP, remotePort, UDP)` tuple with a **60-second idle timeout**, permitting replies from that remote endpoint back through without prompting ([ALE Stateful Filtering](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-stateful-filtering)).
- **Routing-table probes** that bind an ephemeral UDP socket and `connect()` to a documentation IP without listening (like [`lan_ip()` in `src-tauri/src/wire.rs`](../../src-tauri/src/wire.rs#L86-L93)) do not trigger an inbound prompt.

### 1.2 Binding a listening TCP or UDP port (`0.0.0.0` / `[::]`)

- **TCP:** Calling `listen()` on a wildcard or non-loopback address is evaluated at `FWPM_LAYER_ALE_AUTH_LISTEN_V4`/`V6`, and accepted connections hit `FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4`/`V6` ([ALE Layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers)).
- **UDP:** Binding a UDP socket and receiving *unsolicited* inbound unicast or multicast datagrams (for example, an incoming uTP packet, an un-queried DHT message, mDNS on `5353`, or BitTorrent LSD on `6771`) hits `FWPM_LAYER_ALE_AUTH_RECV_ACCEPT_V4`/`V6` ([ALE Layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers)).
- Because `DefaultInboundAction = Block` and `NotifyOnListen = True`, the first time a process listens on a non-loopback socket with no matching inbound Allow rule, Windows triggers the **Windows Security Alert** ("Query User") dialog:
  - **Local Administrator clicks Allow access:** Windows creates inbound Allow rule(s) (`TCP` and/or `UDP`) scoped to the executable's **full path** for whichever network profiles the user leaves checked (typically Private by default; Public unchecked unless selected).
  - **Local Administrator clicks Cancel / No / closes the dialog:** Windows creates explicit inbound **Block** rules (`TCP Query User{GUID}<FullExePath>` and/or `UDP Query User{GUID}<FullExePath>`). Because explicit Block rules outrank all Allow rules ([Firewall Rules — Rule precedence](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules#rule-precedence-for-inbound-and-outbound-rules)), **Windows will never prompt again** on subsequent launches; unsolicited inbound connections to that executable remain silently blocked until those rules are deleted ([Firewall Rules — Applications rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules#applications-rules)).
  - **Outbound continues to work even after a Query User block:** The Query User block rule is created for the **inbound** direction triggered at listen/recv-accept; outbound TCP `connect()` and outbound UDP requests with stateful replies remain allowed under default outbound policy ([Firewall Rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)).

### 1.3 Binding only `127.0.0.1` / `::1`

- Windows Defender Firewall's default block and Query User prompt filters apply to **non-loopback** traffic; Win32 desktop applications binding `127.0.0.1` or `::1` (such as a local HTTP media-streaming endpoint serving `libmpv` on the same machine) **do not trigger the Windows Security Alert**, and are inherently unreachable from other hosts on the network ([ALE Layers](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-layers); note that UWP/AppContainer loopback isolation via `CheckNetIsolation` does not apply to Win32 desktop executables like the Tauri Host).
- Consequence for sidecar/embedded HTTP servers: if a torrent engine exposes a local HTTP stream URL only for the Host's own Player and binds `127.0.0.1`, that HTTP socket itself adds no firewall prompt. Only sockets bound on `0.0.0.0` / `[::]` / LAN IP (peer TCP/uTP listeners, DHT, LSD, or LAN-exposed HTTP) are subject to inbound firewall prompts.

### 1.4 Per-user NSIS install (`installMode: "currentUser"`) specifics

- `src-tauri/tauri.windows.conf.json` configures `"nsis": { "installMode": "currentUser" }` ([`tauri.windows.conf.json`](../../src-tauri/tauri.windows.conf.json#L1-L10)). Per Tauri's NSIS template ([`installer.nsi`](https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi#L110-L112)), `"currentUser"` sets `RequestExecutionLevel user`, installs without UAC into `%LOCALAPPDATA%\<ProductName>` (`%LOCALAPPDATA%\streamingapp\streamingapp.exe`), and writes uninstall entries to `HKCU`.
- **Per-user install path (`%LOCALAPPDATA%`) vs. firewall rules:**
  - Windows Firewall rules match by **exact full executable path** and do **not** support path wildcards (`C:\*\app.exe` is invalid) ([Firewall Rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules)). A rule created for `C:\Users\Alice\AppData\Local\streamingapp\streamingapp.exe` applies only to Alice's install, not another user's profile or a dev binary in `target\release\streamingapp.exe`.
  - Standard Tauri NSIS updates overwrite `streamingapp.exe` at the same `%LOCALAPPDATA%\streamingapp\streamingapp.exe` path, so an existing Allow (or Block) rule persists across updates, whereas spawning a **separate sidecar `.exe`** (e.g., `TorrServer.exe` or `stremio-runtime.exe`) creates a *second* distinct executable path that Windows Defender Firewall evaluates and prompts/blocks independently.
- **Standard (non-administrator) Windows user vs. Administrator user:**
  - A per-user NSIS install succeeds under a **non-administrator (standard) account**, whereas Windows Defender Firewall rule creation is a **machine-wide** privilege.
  - Per Microsoft Learn (*Windows Firewall Rules — Applications rules* & *Known issues with automatic rule creation*):
    > *"If the user isn't a local admin and they are prompted, block rules are created. It doesn't matter what option is selected."* ([Firewall Rules](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules#applications-rules))
  - Therefore, when a non-admin user runs a per-user install and the Host triggers the Windows Security Alert, even clicking/dismissing the dialog cannot add a persistent Allow rule without administrator elevation—leaving explicit inbound Block rules (`TCP/UDP Query User`) in place unless pre-staged by an admin or suppressed.

---

## 2. Usability of a torrent client with outbound connections only

### 2.1 Peer wire (TCP / uTP): usable outbound-only, with asymmetric reachability loss

- **Download and upload both work over outbound connections.** Per [BEP 3](https://www.bittorrent.org/beps/bep_0003.html), peer wire connections are **symmetrical** once established: a peer that dials outbound (`connect()` over TCP or uTP) completes the BitTorrent handshake and exchanges `interested`, `unchoke`, `request`, and `piece` messages in both directions.
- **What is lost without an accepted inbound peer port:**
  1. **Unreachable firewalled/NATed peers (the mutual-NAT problem):** Neither side can dial a peer that is also behind a firewall or NAT without an open port. The Host can only connect to peers that *are* reachable from the internet (seedboxes, VPSs, or home peers with port forwarding / UPnP / open IPv6). On well-seeded public swarms this is usually enough to stream; on sparse/low-seed swarms where most seeders are themselves behind residential NAT or CGNAT, reachable peer count drops sharply.
  2. **Peer discovery latency and no passive inbound swarm growth:** New peers joining the swarm cannot connect to the Host; the Host only learns of peers by polling trackers, DHT, and PEX itself and initiating outbound connections.
  3. **Reduced upload/seeding reciprocation:** Firewalled leechers cannot connect inbound to pull pieces from the Host (`libtorrent` explicitly requires `seeding_outgoing_connections` enabled for NAT/firewalled clients to upload by initiating outbound connections to peers: [`reference-Settings.html`](https://libtorrent.org/reference-Settings.html)).
  4. **Holepunching (`BEP 55` `ut_holepunch`) caveats:** [BEP 55](https://www.bittorrent.org/beps/bep_0055.html) lets two NATed peers use a mutually connected third peer as a `rendezvous` to punch a uTP connection. `libtorrent` and `anacrolix/torrent` support BEP 55; `librqbit` currently does not list `ut_holepunch` in its session/listen stack ([`listen.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit/src/listen.rs)). Crucially, **BEP 55 only works if both sides send UDP packets first to open local stateful flows** and requires a listening/shared uTP UDP socket. If the Host has a local Windows Defender Firewall `UDP Query User` **Block** rule and does not send an outbound UDP packet *before* the remote peer's `connect` packet arrives, Windows drops the incoming holepunch packet regardless of NAT router behavior.

### 2.2 DHT (BEP 5): outbound queries work; responder/refresh behavior and engine gotchas matter

- **Outbound DHT works without an inbound rule:** Under [BEP 5](https://www.bittorrent.org/beps/bep_0005.html), KRPC queries (`ping`, `find_node`, `get_peers`, `announce_peer`) are single UDP request/response pairs. Each query sent from the Host's UDP DHT socket opens Windows ALE's **60-second** stateful flow for that `(nodeIP, nodePort)` tuple ([ALE Stateful Filtering](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-stateful-filtering)), so the remote node's reply returns through Windows Defender Firewall without needing an inbound Allow rule.
- **What is lost when the DHT UDP port is blocked/unsolicited-inbound-denied:**
  1. **The Host is a read-only DHT node, not a "good" responder:** Other nodes' unsolicited `ping`, `find_node`, and `get_peers` requests are dropped at the firewall/NAT. Per BEP 5:
     > *"Nodes that are not able to receive queries from other nodes usually will need to refresh all buckets periodically to ensure there are good nodes in their table when the DHT is needed."* ([BEP 5](https://www.bittorrent.org/beps/bep_0005.html))
  2. **Peer `PORT` hints & unsolicited queries still trigger a prompt if the engine binds `0.0.0.0` / `[::]`:** Both `librqbit` (`DhtState::with_config` binds `(Ipv6Addr::UNSPECIFIED, 0)` dual-stack UDP unless configured otherwise: [`dht.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/dht/src/dht.rs)) and `anacrolix/torrent` (shares the UDP `ListenPort` socket between uTP and DHT: [`config.go`](https://raw.githubusercontent.com/anacrolix/torrent/master/config.go)) keep a persistent wildcard UDP socket open. Any peer sending a BEP 5 `PORT` ping or remote DHT node querying that IP:port hits `ALE_AUTH_RECV_ACCEPT` and triggers the Windows Security Alert (if not already allowed) or gets dropped silently if blocked.
  3. **Engine-specific outbound-only pitfalls:**
     - **`libtorrent`:** Setting `listen_interfaces` to an empty string **disables all networking, including outgoing uTP, UDP trackers, and DHT** ([`reference-Settings.html`](https://libtorrent.org/reference-Settings.html)). Outbound-only mode in `libtorrent` must still bind `listen_interfaces` and instead set `enable_incoming_tcp = false`, `enable_incoming_utp = false`, `enable_upnp = false`, `enable_natpmp = false`.
     - **`librqbit`:** `SessionOptions::default()` already sets `listen: None` (no TCP/uTP peer listener and no UPnP port forwarding) while enabling DHT (`dht: Some(...)`), outbound TCP (`connect`), and trackers—**except** `disable_local_service_discovery` defaults to `false`, which binds a multicast UDP socket on `[::]:6771` (`239.192.152.143` / `ff15::efc0:988f`) ([`session.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit/src/session.rs), [`librqbit_lsd/lib.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit_lsd/src/lib.rs)).

---

## 3. UPnP IGD and NAT-PMP / PCP port mapping

### 3.1 What port mapping needs from the app

1. **A real inbound listening port:** Port mapping instructs the home router (IGD) to forward an external port to `<local_lan_ip>:<internal_port>`. It serves no purpose unless the engine is actually listening on `<internal_port>`.
2. **UPnP IGD workflow:**
   - Send SSDP `M-SEARCH` UDP multicast to `239.255.255.250:1900` (`urn:schemas-upnp-org:device:InternetGatewayDevice:1` / `WANIPConnection:1` / `upnp:rootdevice`) and read the router's unicast reply containing its `LOCATION` XML URL.
   - Fetch the XML descriptor via outbound HTTP `GET` and call `AddPortMapping` (and ideally `DeletePortMapping` on shutdown) via outbound HTTP `POST` SOAP ([`librqbit upnp/lib.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/upnp/src/lib.rs), [`anacrolix/upnp`](https://raw.githubusercontent.com/anacrolix/upnp/master/upnp.go)).
3. **NAT-PMP (RFC 6886) / PCP (RFC 6887) workflow:**
   - Send unicast UDP requests from an ephemeral port to `<default_gateway>:5351` and receive the router's reply ([`libtorrent natpmp.cpp`](https://raw.githubusercontent.com/arvidn/libtorrent/RC_2_0/src/natpmp.cpp)).
4. **Router mapping does NOT bypass Windows Defender Firewall:** Even after a router creates a UPnP/NAT-PMP mapping, external peers' SYN or unsolicited UDP packets arrive at the Windows NIC as **unsolicited inbound traffic** and are dropped by Windows Defender Firewall unless the Host executable has an inbound Allow rule on the active network profile.

### 3.2 Whether UPnP / NAT-PMP triggers a firewall prompt of its own

| Mechanism | Socket pattern | Triggers a Windows Firewall prompt of its own? | Engine behavior observed in primary sources |
|---|---|---|---|
| **Ephemeral-socket SSDP `M-SEARCH` + HTTP SOAP** | Binds UDP `(0.0.0.0, 0)`, multicasts to `239.255.255.250:1900`, receives responses; then outbound HTTP | **No (within 4 seconds).** Per Microsoft Learn, outbound multicast/broadcast at ALE creates a **4-second ALE flow** that permits inbound unicast/multicast/broadcast replies from any remote address without prompting ([ALE Multicast/Broadcast](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-multicast-broadcast-traffic)). *(Replies arriving after 4s without re-sending `M-SEARCH` are dropped by ALE.)* | `librqbit` ([`upnp/lib.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/upnp/src/lib.rs) — note `librqbit` maps **TCP only**, not UDP; its discovery timeout is 10s), `anacrolix/upnp` ([`upnp.go`](https://raw.githubusercontent.com/anacrolix/upnp/master/upnp.go)) |
| **Fixed port `1900` SSDP `NOTIFY` listener** | Binds UDP `1900` joined to `239.255.255.250` to listen for router announcements in addition to `M-SEARCH` | **Yes (inbound UDP bind).** Receiving unsolicited multicast `NOTIFY` on port `1900` hits `ALE_AUTH_RECV_ACCEPT` (covered by the per-exe prompt if no UDP Allow rule exists yet) | `libtorrent` `upnp::open_multicast_socket` ([`src/upnp.cpp`](https://raw.githubusercontent.com/arvidn/libtorrent/RC_2_0/src/upnp.cpp)) |
| **NAT-PMP / PCP** | Ephemeral UDP socket sending unicast to `<gateway>:5351` | **No.** Pure outbound UDP request + stateful 60s unicast reply ([ALE Stateful Filtering](https://learn.microsoft.com/en-us/windows/win32/fwp/ale-stateful-filtering)) | `libtorrent` ([`src/natpmp.cpp`](https://raw.githubusercontent.com/arvidn/libtorrent/RC_2_0/src/natpmp.cpp)); `librqbit` and `anacrolix/torrent` do not implement NAT-PMP/PCP in their UPnP packages |

---

## 4. Can the Host's NSIS installer add a firewall rule, and what does it require?

- **Adding a Windows Defender Firewall rule requires Administrator elevation.** Modifying Windows Defender Firewall policy (`netsh advfirewall firewall add rule`, PowerShell `New-NetFirewallRule`, or the `INetFwPolicy2` COM API) writes machine-wide policy under `HKLM\SYSTEM\CurrentControlSet\Services\SharedAccess\Parameters\FirewallPolicy\FirewallRules` and fails with `Access Denied` (`E_ACCESSDENIED`) from an unprivileged process.
- **What the Host ships today (`scripts/cd.sh`, `scripts/windows/build.ps1`, `src-tauri/tauri.windows.conf.json`):**
  - `scripts/cd.sh` stages the build and `scripts/windows/build.ps1 -Bundle` runs `cargo-tauri tauri build --bundles nsis`, producing an **unsigned** NSIS installer (`streamingapp_<version>_x64-setup.exe`; see `docs/agents/ci.md` and [`build.ps1`](../../scripts/windows/build.ps1)).
  - `src-tauri/tauri.windows.conf.json` sets `"installMode": "currentUser"`, which compiles Tauri's [`installer.nsi`](https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-bundler/src/bundle/windows/nsis/installer.nsi#L110-L127) with **`RequestExecutionLevel user`**.
- **Consequences for installer-managed rules:**
  1. **Without changing elevation, the current NSIS installer cannot add a firewall rule.** It runs at standard user privilege.
  2. **Changing elevation options has trade-offs:**
     - Switching `installMode` to `"perMachine"` (`RequestExecutionLevel admin`, installs under `$PROGRAMFILES64`) or `"both"` (`MULTIUSER_EXECUTIONLEVEL Highest`, elevates for admins), or adding an `NSIS_HOOK_POSTINSTALL` (`installerHooks` in Tauri) that shells out with `runas`, introduces a **UAC elevation prompt** at install time.
     - Because the release NSIS `.exe` is currently **unsigned** (`docs/agents/ci.md`), requesting UAC elevation presents an *"Unknown publisher"* warning (and fails on accounts without local admin credentials).
  3. **Exact binary path and cleanup:** Rules must name the exact target binary (`$INSTDIR\streamingapp.exe`, plus any bundled sidecar `.exe` under `$INSTDIR` if out-of-process), should scope to Private (or Local Subnet for LAN-only services) per [Microsoft's rule recommendations](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules#firewall-rules-recommendations), and should be removed in `NSIS_HOOK_POSTUNINSTALL`.
  4. **Enterprise / managed hosts:** If `AllowLocalPolicyMerge` is disabled via GPO or MDM CSP on a machine, local rules added by an installer (or by the user's prompt) are ignored ([Firewall Rules — Local policy merge](https://learn.microsoft.com/en-us/windows/security/operating-system-security/network-security/windows-firewall/rules#local-policy-merge-and-application-rules)).

---

## 5. Baseline: how the Host's existing LAN listener (`crates/host-wire/`) behaves today

The Host **already** opens inbound non-loopback TCP and UDP sockets at startup for the *Remote client*:

1. **TCP HTTP + WebSocket listener (`0.0.0.0:8090`, fallback `0.0.0.0:0`):**
   - [`src-tauri/src/wire.rs`](../../src-tauri/src/wire.rs#L33-L44) calls [`host_wire::Server::start`](../../crates/host-wire/src/server.rs#L112-L134), which calls `TcpListener::bind` on `SocketAddr::from((Ipv4Addr::UNSPECIFIED, 8090))` (`DEFAULT_PORT`), falling back to `0.0.0.0:0` if `8090` is occupied.
2. **mDNS UDP port `5353` multicast socket:**
   - [`src-tauri/src/wire.rs`](../../src-tauri/src/wire.rs#L55-L71) calls [`Mdns::advertise`](../../crates/host-wire/src/discovery.rs#L85-L101), which initializes `mdns_sd::ServiceDaemon::new()` (`mdns-sd 0.21.5`). `mdns-sd` binds UDP port `5353` multicast sockets (`224.0.0.251` / `ff02::fb`) using `mio::Waker` for wakeups (rather than loopback UDP sockets) ([`service_daemon.rs`](https://raw.githubusercontent.com/keepsimple1/mdns-sd/main/src/service_daemon.rs)). Although Windows ships a built-in `mDNS (UDP-In)` rule, that rule is scoped to `%SystemRoot%\System32\svchost.exe`, not `streamingapp.exe`.
3. **Routing probe (`lan_ip()`):**
   - [`lan_ip()`](../../src-tauri/src/wire.rs#L86-L93) binds an ephemeral UDP socket and calls `connect(192.0.2.1:80)` to read the chosen interface address. No packets are sent and nothing listens, so this step alone does not prompt.

**Baseline implication:** On a clean Windows installation where `streamingapp.exe` has not yet been allowed, **the existing Host already triggers the Windows Security Alert on first launch** because `host-wire` binds TCP `0.0.0.0:8090` and `mdns-sd` binds UDP `5353`. (Automated verification in [`scripts/windows/verify.ps1`](../../scripts/windows/verify.ps1) exercises the Host against a local fixture Provider on `127.0.0.1:8099` and skips Remote client LAN pairing unless tested interactively; any dev run uses `target\release\streamingapp.exe` rather than the installed `%LOCALAPPDATA%\streamingapp\streamingapp.exe` path.)

Note also on port overlap: if an external sidecar like **TorrServer** is run with its default `-p 8090` on `0.0.0.0` ([`cmd/main.go`](https://raw.githubusercontent.com/YouROK/TorrServer/master/server/cmd/main.go)), it targets the exact same default TCP port `8090` as `host-wire::DEFAULT_PORT`.

---

## 6. What the engine choice (#293) and spec must account for

This note does not pick an engine or a firewall strategy; it records the constraints Windows places on whatever #293 and the streaming spec choose:

1. **In-process vs. separate sidecar executable changes firewall identity:**
   - Embedding an engine in-process (`librqbit` or `libtorrent` linked into `streamingapp.exe`) shares the **same executable path** that `host-wire` already prompts for once on first launch. If the user already clicked Allow for `streamingapp.exe` on TCP + UDP, peer/DHT/uTP listeners on `streamingapp.exe` reuse that permission (assuming the profile—Private vs. Public—matches).
   - Shipping a separate sidecar binary (`TorrServer`, `stremio-runtime.exe`, etc.) gives Windows Defender Firewall a **second `.exe` path**. If the sidecar binds wildcard TCP/UDP ports, Windows raises a second Windows Security Alert (and must be tracked separately if an installer creates rules).
2. **Default socket binds differ sharply across candidate engines:**
   - **`librqbit`:** Default `SessionOptions` has `listen: None` (outbound-only TCP peers, no UPnP) + wildcard dual-stack DHT UDP (`[::]:0`) + **LSD multicast UDP (`[::]:6771` on by default)** ([`session.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit/src/session.rs), [`librqbit_lsd/lib.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/librqbit_lsd/src/lib.rs)). Its built-in UPnP crate forwards **TCP only**, not UDP ([`upnp/lib.rs`](https://raw.githubusercontent.com/ikatson/rqbit/main/crates/upnp/src/lib.rs)), and has no BEP 55 holepunching.
   - **`libtorrent`:** Default binds TCP + uTP + DHT + SSDP UDP `1900` + NAT-PMP/PCP; clearing `listen_interfaces` breaks outbound uTP/DHT/UDP trackers too, so outbound-only requires keeping `listen_interfaces` and toggling `enable_incoming_tcp`/`enable_incoming_utp`/`enable_upnp`/`enable_natpmp` ([`reference-Settings.html`](https://libtorrent.org/reference-Settings.html)). Supports BEP 55 `ut_holepunch`.
   - **`anacrolix/torrent` / `TorrServer`:** By default shares one UDP socket for uTP + DHT on `ListenPort` (`0` = ephemeral in TorrServer when `PeersListenPort == 0`), enables UPnP (TCP + UDP) and optionally LPD, and exposes BEP 55 holepunching ([`config.go`](https://raw.githubusercontent.com/anacrolix/torrent/master/config.go), [`btserver.go`](https://raw.githubusercontent.com/YouROK/TorrServer/master/server/torr/btserver.go)). Notice TorrServer's HTTP server defaults to `:8090` unless overridden (colliding with `host-wire`'s `DEFAULT_PORT = 8090`).
   - **`stremio-service`:** Spawns `stremio-runtime.exe server.js` under a lowest-privilege Inno Setup installer (`PrivilegesRequired=lowest`) with no installer-added firewall rule ([`StremioService.iss`](https://raw.githubusercontent.com/Stremio/stremio-service/master/setup/StremioService.iss), [`src/server.rs`](https://raw.githubusercontent.com/Stremio/stremio-service/master/src/server.rs)).
3. **Loopback-only HTTP stream server avoids an unnecessary listener:**
   - When the local `Player` (`host-mpv`) reads a `Stream` from an internal HTTP bridge, binding that HTTP endpoint to `127.0.0.1` triggers **no** Windows Firewall prompt and avoids exposing media endpoints on the LAN (unlike Cast / Remote playback scenarios, if any, which require LAN reachability).
4. **Silent degradation vs. user action when inbound is blocked or standard-user:**
   - If a user dismisses the Windows Security Alert once—or runs the `currentUser` install under a non-admin Windows account—Windows creates persistent inbound **Block** rules (`TCP/UDP Query User`). Outbound tracker/HTTP/TCP peer dialing and outbound UDP DHT queries still function, while unsolicited inbound peers and passive DHT queries stop. The spec must decide whether outbound-only fallback is acceptable without warning or whether the Host needs to surface inbound-blocked diagnostics (e.g., when a swarm has few unfirewalled peers or during Remote client pairing).
5. **Current installer posture (`currentUser`, unsigned):**
   - Pre-creating firewall rules in the NSIS installer requires switching away from silent `RequestExecutionLevel user` (forcing UAC elevation on a currently unsigned binary and failing for non-admin users) and keeping exact `.exe` path parity across `$INSTDIR` and any sidecar binaries. Leaving rules to first-launch prompts requires accounting for `host-wire` already prompting on TCP `8090` + UDP `5353` at startup—not only when torrent playback first begins.
