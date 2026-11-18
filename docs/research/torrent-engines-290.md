# Torrent engines that can ship inside the installer (#290)

**Date**: 2026-11-16
**Scope**: Wayfinder research for [#290](https://github.com/MenotiFilho/streamingapp/issues/290) under map [#283](https://github.com/MenotiFilho/streamingapp/issues/283), informing [#293](https://github.com/MenotiFilho/streamingapp/issues/293) (*Which torrent engine the Host uses*). Evaluates which BitTorrent engines can ship inside `streamingapp`'s Windows NSIS installer with zero extra user setup, and what each costs. No engine is selected here.

---

## Host baseline and constraints

Facts established from the current repository before evaluating candidates:

- **Licence & distribution (`ADR-0004`, `Cargo.toml`)**: The workspace is licensed `GPL-3.0-or-later` (`Cargo.toml:20`) and links stock GPL `libmpv` in-process via `libmpv2` (`crates/host-mpv/Cargo.toml:20`, `docs/adr/0004-gpl3-with-stock-gpl-mpv.md`). `scripts/windows/build.ps1` downloads `mpv-dev-x86_64-v3` from `shinchiro/mpv-winbuild-cmake`, bundles `libmpv-2.dll` beside `streamingapp.exe`, and builds the Windows NSIS installer (`cargo-tauri tauri build --bundles nsis`). Any bundled engine or library must be legally combinable / redistributable in that NSIS installer under `GPL-3.0-or-later`.
- **Workspace rules & runtime (`Cargo.toml`)**: `[workspace.lints.rust] unsafe_code = "forbid"` (`Cargo.toml:49`) is inherited across all Host crates, including `crates/host-mpv/Cargo.toml:8-20`. The Host currently has **no `tokio` runtime** (`ureq` synchronous HTTP + OS threads in `Cargo.toml`).
- **Player seam (`crates/host-mpv`, `libmpv2` v6)**: `libmpv2::protocol::Protocol::new` wraps `mpv_stream_cb_add_ro` (`open`/`read`/`seek`/`size`/`close`), **but `Protocol::new` is `pub unsafe fn`** (`libmpv2` v6 `src/mpv/protocol.rs`). Using mpv stream callbacks in-process requires waiving `unsafe_code = "forbid"` (or isolating an `unsafe` adapter crate), whereas feeding the Player a localhost HTTP URL with `Range` (`206 Partial Content`) uses the existing URL path with zero `unsafe`.
- **Linux dev container & Windows CI (`docker/dev.Dockerfile`, `scripts/cd.sh`, `scripts/windows/build.ps1`)**: `docker/dev.Dockerfile` provides `ubuntu:24.04` with `build-essential`, `pkg-config`, `cmake`, `clang`, `libclang-dev`, `libssl-dev`, `mpv`, `libmpv-dev`, `ffmpeg`, Node 22 + pnpm, and stable Rust (`1.99` on target Windows CI). **Neither Go, Boost, nor NASM** is installed in `docker/dev.Dockerfile` or `scripts/windows/build.ps1`.

---

## Candidates investigated

| Candidate | Model | Pinned upstream revision / version | Verdict on installer eligibility |
| --- | --- | --- | --- |
| **`librqbit`** (`ikatson/rqbit`) | In-process Rust crate | `v9.1.0` (2026-10-29) | Eligible |
| **`libtorrent-rasterbar`** (`arvidn/libtorrent`) via Rust bindings | In-process C++ library + Rust FFI | Upstream `v2.1.2` / `v2.0.15`; `lt-rs` `v0.1.4`, `libtorrent-sys` `v1.0.0`, `rbtorrent` | Upstream eligible; existing Rust bindings fail on MSVC or lack streaming API |
| **`TorrServer`** (`YouROK/TorrServer`) | Bundled Go sidecar (`CGO_ENABLED=0`) | `MatriX.150` (2026-11-06) / `Silo.2` (2026-11-14) | Eligible (`GPL-3.0`, large binary + side effects) |
| **`stremio-service` / `server.js`** (`Stremio/stremio-service`, `Stremio/enginefs`) | Bundled Rust/Node sidecar | `v0.1.22` (2026-08-25) / `server.js v4.21.1` | **Disqualified (licensing)** — `server.js` is proprietary/unlicensed |
| **Custom Go sidecar over `anacrolix/torrent`** (+ `confluence`) | Bundled Go sidecar (`CGO_ENABLED=0`) | `anacrolix/torrent v1.62.0` | Eligible (`MPL-2.0`, requires Go toolchain + thin sidecar) |
| **`irontide`** (`codeberg.org/alan090/irontide`) *(supplemental)* | In-process Rust crate | `v1.7.0` | Eligible (`GPL-3.0-or-later`), low maturity & unverified streaming |

---

## 1. `librqbit` (linked in-process)

**Primary sources**: [`ikatson/rqbit`](https://github.com/ikatson/rqbit) (`v9.1.0`, tag `2026-10-29`), [`crates.io/crates/librqbit`](https://crates.io/crates/librqbit), downstream streaming desktop apps [`ventic/ventic`](https://github.com/ventic/ventic) and [`torrentplayer/torrentplayer`](https://github.com/torrentplayer/torrentplayer).

- **Licence & ADR-0004**: `Apache-2.0` (`rqbit/LICENSE:4`, `crates/librqbit/Cargo.toml:6`; GitHub's license detector reports `NOASSERTION` only because the file has a preamble before the standard Apache-2.0 header). `Apache-2.0` is one-way compatible with `GPL-3.0-or-later`; linking it in-process with the Host and stock GPL mpv is permitted, with the combined binary distributed under `GPL-3.0-or-later`.
- **Build (Windows MSVC w/ Rust 1.99, Linux container), native deps, size**:
  - `edition = "2024"`, MSRV `1.85` (`crates/librqbit/Cargo.toml:5`). Upstream CI (`.github/workflows/test.yml`) builds and tests on `windows-latest`, `ubuntu-latest`, and `macos-latest` on Rust `1.94` and `1.97` (compatible with Rust `1.99`).
  - **Crucial Windows TLS/crypto feature choice**: `default-tls` (`crates/librqbit/Cargo.toml:25-29`) uses `reqwest/default-tls` (`native-tls`: Windows Schannel on MSVC, OpenSSL `libssl-dev` already present in `docker/dev.Dockerfile` on Linux) and `sha1w/sha1-crypto-hash` (Windows CNG/CryptoAPI, OpenSSL on Linux) — **zero new system dependencies** in either environment. By contrast, enabling `rust-tls` pulls `sha1w/sha1-ring` which switched to `aws-lc-rs` (`crates/sha1w/Cargo.toml:15`), requiring **NASM** on Windows x86_64 (`ventic/ventic` `src-tauri/Cargo.toml` documents: *"aws-lc-rs, whose x86_64 assembly is NASM's ... a Windows box has no nasm and the build script panics"*).
  - Pulls a multi-threaded `tokio` runtime (~80+ crates; plus `axum`/`tower-http` if `http-api` is enabled) into the Host, which currently uses only `ureq` + OS threads.
  - **Size**: Prebuilt `rqbit.exe` (`v9.1.0` Windows CLI+WebUI) is **12,760,064 bytes (~12.2 MiB)**; Tauri `rqbit-desktop_9.1.0_x64_en-US.msi` is **7,241,728 bytes (~6.9 MiB)**. Embedded in-process without the CLI/WebUI `[inference]` adds roughly **5–10 MiB** uncompressed to `streamingapp.exe`.
- **Streaming while downloading**:
  - Exposes `ManagedTorrent::stream(file_id) -> FileStream` (`crates/librqbit/src/torrent_state/streaming.rs:107`) implementing `tokio::io::AsyncRead + AsyncSeek`.
  - `StreamState` (`streaming.rs:24-48`) maintains a **32 MiB** lookahead (`PER_STREAM_BUF_DEFAULT = 32 * 1024 * 1024`) from the current read/seek byte position, interleaves priority across concurrent streams, wakes parked readers via `wake_streams_on_piece_completed`, and `PieceTracker::acquire_piece` (`piece_tracker.rs:117-128`) schedules `priority_pieces` ahead of queued pieces plus 3x/10x slow-peer piece stealing.
  - Optional `http-api` feature includes an Axum HTTP streaming route (`/torrents/{id}/stream/{file_id}`, `http_api/handlers/streaming.rs:25-115`) supporting `206 Partial Content`, `Accept-Ranges: bytes`, `HEAD`, and DLNA headers. Host can either wrap `FileStream` in a tiny localhost HTTP `Range` server (keeping `host-mpv` free of `unsafe`) or bridge it to `libmpv2::protocol::Protocol` via `tokio::runtime::Handle::block_on`.
  - **Bounded-storage caveat**: Unpatched `librqbit` prioritizes the 32 MiB window around the seek head, then keeps downloading the *rest* of the selected file(s) (`queued_pieces`) to disk and does **not** evict pieces behind the reader. (`ventic/ventic` `src-tauri/Cargo.toml` notes: *"a torrent can be told to fetch only around its readers, and to forget what they have left behind. No release of librqbit can do either"*, maintaining `vendor/librqbit.patch` for bounded streaming.)
- **File selection, `infoHash`, magnet URI, tracker list**:
  - `AddTorrentOptions::only_files: Option<Vec<usize>>` selects files by **0-based** metainfo index (`session.rs:200,306`), or via magnet `&so=`.
  - `AddTorrent::Url` accepts `.torrent` `http(s)://` URLs, `magnet:` URIs, and bare 40-hex BTv1 `infoHash` strings (`session.rs:1110-1135`, `crates/librqbit_core/src/magnet.rs:58`). BTv1 only (`magnet.as_id20()`, `session.rs:1111`; BTv2 `btmh` is rejected).
  - **Tracker merge bug/quirk**: `opts.trackers` is merged into the torrent only on the `.torrent`/URL branch (`session.rs:1165`), **not** on the `magnet:`/bare `infoHash` branch (`session.rs:1121-1131`). To attach Stremio Addon `sources` trackers to an `infoHash`, the Host must encode `&tr=` parameters into a magnet URI (or populate `SessionOptions::trackers`).
- **Network (DHT, PEX, trackers, uTP, UPnP, ports, no inbound port)**:
  - Persistent DHT (`librqbit-dht`), PEX (`UtPex`, `live/mod.rs:76,2031`), HTTP/UDP trackers (`tracker_comms`), LSD (`librqbit-lsd`), uTP (`librqbit-utp`), UPnP (`librqbit-upnp`).
  - Defaults in `crates/librqbit/src/listen.rs:46-50`: `ListenerOptions::mode` defaults to **`ListenerMode::TcpOnly`** (with a `TODO` to enable uTP by default; `TcpAndUtp` is opt-in), `listen_addr` defaults to `[::]:0`, and `enable_upnp_port_forwarding` defaults to **`false`**. Setting `SessionOptions::listen = None` disables listening entirely (outbound-only).
  - Works with no inbound port via outbound TCP/uTP connections discovered from DHT, PEX, and trackers.
  - **Windows socket quirks**: `torrentplayer` (`vendor/librqbit-dht/TORRENTPLAYER.md`) hit `WSAEMSGSIZE`/`WSAECONNRESET` killing `librqbit-dht` v9.0.1's recv loop; `v9.1.0` fixed this in `crates/dht/src/dht.rs:1202-1208` (`is_datagram_error(&e)`). However, `UdpTrackerClient::new` (`crates/tracker_comms/src/tracker_comms_udp.rs:273`) still unconditionally binds UDP `[::]:0` at `Session` startup before any torrent starts (triggering a Windows Defender Firewall prompt on first run if `disable_trackers` is false).
- **Upload control**:
  - `LimitsConfig { upload_bps: Option<NonZeroU32>, download_bps: Option<NonZeroU32> }` (`limits.rs:10`) enforced via `governor` token bucket, adjustable at runtime via `Session::ratelimits`.
  - Full stop supported both at compile time (Cargo feature `disable-upload`) and runtime (`SessionOptions::disable_upload: bool`, `live/mod.rs:615,1225,1483`).
- **Storage**:
  - Default `FilesystemStorageFactory` writes sparse files (`FSCTL_SET_SPARSE` on Windows, `crates/librqbit/src/storage/filesystem/fs.rs:58`), relying on OS page cache (`pread`/`pwrite`/mmap-free positional I/O).
  - `InMemoryExampleStorageFactory` and `WriteThroughCacheStorageFactory` exist in-tree as explicit untested examples (`write_through_cache.rs:4`: *"An example, untested and unproven to be useful"*).
  - `Session::delete(id, true)` (`session.rs:1429`) pauses, drops metadata/session persistence, and deletes downloaded files and empty parent directories.
- **Runtime reporting**:
  - `TorrentStats` / `LiveStats` (`stats.rs`) and `StatsSnapshot` (`snapshot.rs`): `state` (`initializing`/`live`/`paused`/`error`), `error: Option<String>`, `progress_bytes`, `uploaded_bytes`, `total_bytes`, `file_progress: Vec<u64>`, `download_speed`, `upload_speed`, `time_remaining`, `AggregatePeerStats` (`queued`, `connecting`, `live`, `live_tcp`, `live_utp`, `live_seeders`, `seen`, `dead`, `not_needed`, `steals`), plus per-peer `api_peer_stats` (`addr`, `state`, `counters`).
- **Maturity**:
  - `ikatson/rqbit`: 1,995 GitHub stars; **103 open issues** (`9` matching `stream`, `6` matching `windows` via GitHub Search API on 2026-11-16). Active cadence (`v9.0.0` 2026-08-15, `v9.0.1` 2026-08-20, `v9.1.0` 2026-10-29).
  - `crates.io/crates/librqbit`: **204,181 total downloads**, **109,178 recent downloads**, 21 reverse dependents. Production/downstream users: `rqbit` CLI/WebUI/Tauri desktop, `ventic/ventic` (184 stars, Tauri + mpv), `torrentplayer/torrentplayer` (991 stars, forks `librqbit` v9).

---

## 2. `libtorrent-rasterbar` (via Rust bindings)

**Primary sources**: [`arvidn/libtorrent`](https://github.com/arvidn/libtorrent) (`v2.1.2`, 2026-09-25; `v2.0.15` LTS), Rust wrapper crates [`zko-jin/lt-rs`](https://github.com/zko-jin/lt-rs) (`v0.1.4`, `anawt` `v0.1.1`), [`shawone/libtorrent-sys`](https://github.com/shawone/libtorrent-sys) (`v1.0.0`), [`vorot93/rbtorrent`](https://github.com/vorot93/rbtorrent).

- **Licence & ADR-0004**:
  - Upstream `libtorrent-rasterbar` is `BSD-3-Clause` (`libtorrent/COPYING`), compatible with `GPL-3.0-or-later` and stock GPL mpv. Linking OpenSSL 3.x (`Apache-2.0`) is also GPL-3.0 compatible (unlike legacy OpenSSL 1.x), or Windows can build with `crypto=built-in` / Win32 `bcrypt`+`crypt32`.
  - Wrapper crates: `lt-rs` and `libtorrent-sys` are `MIT`; **`rbtorrent` is `GPL-3.0-only WITH Classpath-exception-2.0`**, which conflicts with `streamingapp`'s `GPL-3.0-or-later` unless relicensed or avoided.
- **Build (Windows MSVC w/ Rust 1.99, Linux container), native deps, size**:
  - Upstream `libtorrent` `v2.1.2` requires a **C++17** compiler (`CMakeLists.txt:551`), **Boost** headers (`.github/workflows/windows.yml:30` clones `boost-1.91.0` and builds `b2 headers`), **CMake or Boost.Build (`b2`)**, and optionally **OpenSSL** (`TORRENT_USE_OPENSSL`; `webtorrent=on` additionally requires `libdatachannel`). Neither Boost nor `libtorrent-rasterbar` is present in `docker/dev.Dockerfile` or `scripts/windows/build.ps1`.
  - **Rust binding gap (blocking for off-the-shelf crates)**:
    - `lt-rs` `v0.1.4` (6 stars, 571 crates.io downloads, last crates.io release 2026-02-16, repo pushed 2026-10-25): `build.rs:21-83` hardcodes `b2`, `libtorrent-rasterbar.a`, `cxx.compiler("clang++")`, and `-lssl -lcrypto` — **does not compile on Windows MSVC**.
    - `libtorrent-sys` `v1.0.0` (17 stars, 4,218 downloads, unmaintained since 2022-06-03): links a preinstalled system `-ltorrent-rasterbar` via `pkg-config` and exposes only **9 C functions** (no piece deadlines, file priorities, upload limits, or alerts).
    - `rbtorrent` (2 stars, not on crates.io, unmaintained since 2022-09-05): compiles via CMake + OpenSSL, but lacks `set_piece_deadline`, `read_piece`, `prioritize_files`, and upload limits.
  - Using `libtorrent-rasterbar` reliably across Windows MSVC + Linux requires writing and maintaining a custom `cxx` FFI crate plus provisioning Boost (+ OpenSSL) in both `dev.Dockerfile` and Windows CI (e.g., via `vcpkg` or vendored Boost headers).
  - **Size**: Upstream PyPI wheel `libtorrent-2.1.2-cp313-cp313-win_amd64.whl` is **5,027,548 bytes (~4.8 MiB)** compressed; linking static `libtorrent` (+ OpenSSL if used) `[inference]` adds **~5–12 MiB** uncompressed.
- **Streaming while downloading**:
  - Best-in-class piece deadline scheduler: `torrent_handle::set_piece_deadline(piece_index_t, deadline_ms, alert_when_available)` (`include/libtorrent/torrent_handle.hpp:445`), `read_piece(piece)` emitting `read_piece_alert` (`torrent_handle.hpp:314`, `alert_types.hpp:304`), and `torrent_flags::sequential_download` (note `set_sequential_download` is deprecated in favor of the flag). (`lt-rs/src/ffi/torrent_handle.rs:24,87-91` exposes `read_piece`, `set_piece_deadline`, `prioritize_files`, `set_upload_limit`.)
  - **No HTTP server or `Read`/`AsyncRead` stream**: Host must build its own byte-range-to-piece mapper feeding either a local HTTP `Range` endpoint or `mpv` `Protocol` callbacks via `read_piece_alert` / file reads.
- **File selection, `infoHash`, magnet URI, tracker list**:
  - `add_torrent_params::file_priorities` / `torrent_handle::prioritize_files` (0-based index, `download_priority_t{0}` = `dont_download`, `torrent_handle.hpp:1203-1206`); shared piece boundaries are isolated into a `.parts` partfile.
  - Supports both v1 and v2 `info_hashes`, `parse_magnet_uri`, and `add_torrent_params::trackers` (`add_torrent_params.hpp:130,190,228`).
- **Network**:
  - DHT, PEX (`ut_pex`), HTTP/UDP/WebSocket trackers, LSD, incoming + outgoing uTP, UPnP, and NAT-PMP are all **enabled by default** (`src/settings_pack.cpp:122,168-198`).
  - Default `listen_interfaces = "0.0.0.0:6881,[::]:6881"` (override to `"0.0.0.0:0,[::]:0"` or `""` for outbound-only). Battle-tested NAT traversal with uTP hole-punching.
- **Upload control**:
  - `settings_pack::upload_rate_limit` / `torrent_handle::set_upload_limit(bytes_per_sec)` (`torrent_handle.hpp:1293`).
  - **No single boolean `disable_upload`**: `torrent_flags::upload_mode` actually pauses *downloads* on disk I/O errors (`torrent_flags.hpp:45-59`). Disabling upload requires setting `settings_pack::unchoke_slots_limit = 0` (`settings_pack.cpp:313`) or `upload_rate_limit = 1` (minimum allowed non-unlimited limit).
- **Storage**:
  - Libtorrent 2.x defaults to `mmap_disk_io_constructor` (`session_params.hpp:94`) with `storage_mode_sparse` and `.parts` files, relying on the OS page cache rather than a user-space RAM piece cache (removed in 2.x).
  - `session::remove_torrent(h, session_handle::delete_files)` (`session_handle.hpp:782,815`) removes downloaded files and `.parts`, posting `torrent_deleted_alert`. Bounded sliding-window disk eviction is not built-in unless Host implements a custom `disk_interface`.
- **Runtime reporting**:
  - Detailed `torrent_status` (`download_payload_rate`, `upload_payload_rate`, `num_peers`, `num_seeds`, `pieces`/`verified_pieces` bitfields, `errc`, `state`, `torrent_status.hpp:116-306`), `post_peer_info()`, and typed alerts (`torrent_error_alert`, `file_error_alert`, `metadata_failed_alert`, `alert_types.hpp:1294,1331,1979`) consumed via `pop_alerts()`.
- **Maturity**:
  - Upstream C++: **6,128 stars**, active releases (`v2.1.2` 2026-09-25, `v2.0.15` LTS), **228 open issues** (`24` `stream`, `48` `windows`). Production users: qBittorrent, Deluge, PicoTorrent, Tribler.
  - Rust binding ecosystem: **immature** (`lt-rs` 6 stars / 571 downloads / Linux-only `build.rs`; `libtorrent-sys` & `rbtorrent` unmaintained since 2022).

---

## 3. `TorrServer` (bundled Go binary)

**Primary sources**: [`YouROK/TorrServer`](https://github.com/YouROK/TorrServer) (`MatriX.150`, 2026-11-06; `Silo.2`, 2026-11-14; note `master` reverted `install.sh` back to `MatriX`).

- **Licence & ADR-0004**: `GPL-3.0` (`TorrServer/LICENSE:1-3`). Compatible with `GPL-3.0-or-later` and stock GPL mpv. Redistributing `TorrServer.exe` inside the NSIS installer is permitted provided GPL-3.0 obligations are met (shipping the licence text plus matching source code / written offer for the exact bundled `TorrServer` commit/fork).
- **Build (Windows MSVC w/ Rust 1.99, Linux container), native deps, size**:
  - Written in Go `1.25.7` (`server/go.mod`), built with `CGO_ENABLED=0` static binaries (`.github/workflows/ts_build.yml`). Zero runtime DLL dependencies, and zero Rust/MSVC interaction, **but** building from source requires adding Go to `docker/dev.Dockerfile` and Windows CI (or downloading a pinned upstream binary during CI staging).
  - **Size**: Official `MatriX.150` `TorrServer-windows-amd64.exe` is **63,884,288 bytes (~60.9 MiB)** (`TorrServer-gst-windows-amd64.exe` is 99.2 MB). Experimental `Silo.2` (2026-11-14) shrinks `TorrServer-windows-amd64.exe` to **35,936,768 bytes (~34.3 MiB)**. The `MatriX` binary is large because it embeds Gin, Swagger UI, a React WebUI, DLNA, Bonjour/mDNS, Telegram bot, Rutor search, Torznab, TMDB scraper, MCP server, and FUSE/WebDAV.
- **Streaming while downloading**:
  - Sidecar HTTP server only (no in-process callback). Serves `/stream` and `/play` (`web/api/stream.go`, `torr/stream.go`) via Go's `http.ServeContent` (full HTTP `Range` / `206`, `HEAD`, DLNA headers) over `torrstor.Reader`, which wraps `anacrolix/torrent`'s `Reader` with `SetResponsive()` enabled and a fixed **16 MiB** readahead (`torr/torrent.go:296`, `torr/stream.go:102`) plus head/tail preloading (`preload.go`).
- **File selection, `infoHash`, magnet URI, tracker list**:
  - `link.go` accepts bare `infoHash`, `magnet:`, `http(s)://`, `file://`, and `torrs://`.
  - **Critical file-index mismatch**: `torr/torrent.go:439-456` sorts torrent files alphabetically (`CompareStrings`) and assigns **1-based** `Id: i + 1`! Passing a Stremio 0-based `fileIdx` directly to `/stream?index=N` will play the **wrong file** on multi-file torrents unless the Host fetches metadata and maps by path/order.
  - `RetrackersMode` defaults to `1` (`btsets.go:99`), which downloads `ngosang/trackerslist` from GitHub/jsDelivr at runtime unless disabled via settings.
- **Network**:
  - Built on `tsynik/torrent` `v1.2.34` (fork of `anacrolix/torrent` `v1.59.1`): DHT, PEX, HTTP/UDP/WS trackers, uTP, UPnP, optional LPD.
  - `PeersListenPort` defaults to `0` (ephemeral, `btserver.go:150`). Works behind NAT without inbound ports.
  - **Side effects**: Unconditionally runs `dnsResolve()` (`cmd/main.go:88`), `publicip.Get4`/`Get6` (`btserver.go:177-212`), and external tracker fetches unless disabled/patched; exposes a full unauthenticated HTTP control API unless bound to `127.0.0.1` (`-i 127.0.0.1`) with auth/port hygiene.
- **Upload control**:
  - `BTSets.UploadRateLimit` (KB/s; note values `> 0` flip `Seed = true` in `btserver.go:137`) and `BTSets.DisableUpload` (`bt.config.NoUpload = true` hard stop in `btserver.go:123`).
- **Storage**:
  - Custom `torrstor.Cache` (`torrstor/cache.go`): default **64 MiB** RAM ring/capacity cache (`UseDisk = false`) or bounded disk cache (`UseDisk = true`), actively evicting pieces outside active reader windows!
  - `RemoveCacheOnDrop` deletes disk cache on drop/removal; `TorrentDisconnectTimeout` (default 30s) auto-drops idle torrents.
- **Runtime reporting**:
  - JSON status (`torr/state/state.go:33`): `stat`, `download_speed`, `upload_speed`, `total_peers`, `pending_peers`, `active_peers`, `connected_seeders`, `half_open_peers`, `pieces_dirtied_good`, `file_stats`, plus `/cache` piece-map endpoint. Error reporting is coarse (HTTP errors + log output).
- **Maturity**:
  - **3,234 stars**; **18 open issues** (`3` `stream`, `3` `windows`); rapid release cadence (`MatriX.146`–`MatriX.150` across Oct–Nov 2026); widely deployed behind Android TV, Kodi, Lampa, and Stremio third-party clients.

---

## 4. `stremio-service` / Stremio streaming server (`server.js` + `enginefs`)

**Primary sources**: [`Stremio/stremio-service`](https://github.com/Stremio/stremio-service) (`v0.1.22`, 2026-08-25), [`Stremio/enginefs`](https://github.com/Stremio/enginefs), [`Stremio/stremio-shell#435`](https://github.com/Stremio/stremio-shell/issues/435), [`Stremio/stremio-service#49`](https://github.com/Stremio/stremio-service/issues/49), [`Stremio/stremio-linux-shell#100`](https://github.com/Stremio/stremio-linux-shell/issues/100).

- **Licence & ADR-0004 (legal blocker)**:
  - `Stremio/stremio-service` (the Rust launcher) is **`GPL-2.0-only`** (`LICENSE.md:3`, `Cargo.toml:7`) — incompatible with combining in-process with `GPL-3.0-or-later`, though sidecar execution is separate.
  - **Showstopper for bundling**: `stremio-service/build.rs:64-73` downloads `https://dl.strem.io/server/v4.21.1/desktop/server.js` at build time and packages it beside `stremio-runtime.exe` (Node.js) + `ffmpeg.exe` + `ffprobe.exe`. Stremio lead developer (`jaruba`) explicitly stated in [`stremio-shell#435`](https://github.com/Stremio/stremio-shell/issues/435) and [`stremio-service#49`](https://github.com/Stremio/stremio-service/issues/49) that **`server.js` is closed-source, proprietary, unlicensed code** (*"not meant to be used / distributed outside of an official Stremio app"*), and distribution packagers (`stremio-shell#435`, `stremio-linux-shell#100`) confirmed it has no redistribution grant and references a missing `server.js.LICENSE.txt`.
  - Likewise, [`Stremio/enginefs`](https://github.com/Stremio/enginefs) has **no `LICENSE` file** (`gh api repos/Stremio/enginefs` returns `"license": null`, i.e., all rights reserved).
  - **Result**: Bundling `stremio-service` or `server.js` inside `streamingapp`'s NSIS installer is **not legally permitted**.
- **Technical profile (recorded for completeness)**:
  - **Size & deps**: `stremio-service-windows.zip` (`v0.1.22`) is **30,810,848 bytes (~29.4 MiB)** zipped and **78,855,479 bytes (~75.2 MiB)** extracted (`stremio-runtime.exe` 65.45 MB, `server.js` 6.68 MB, `stremio-service.exe` 6.20 MB, `ffmpeg.exe` 332 KB, `ffprobe.exe` 180 KB), duplicating `ffmpeg` already linked/available outside core.
  - **Streaming & controls (`enginefs`)**: HTTP `/:infoHash/:idx` (`206 Partial Content`, `Accept-Ranges: bytes`, DLNA/CORS) over Node `torrent-stream`; 0-based `idx`, `?tr=`, `/:infoHash/stats.json`, `/:infoHash/remove`; `peer-search` + `bittorrent-dht` + `ut_pex` (TCP-only, no uTP or UPnP in `enginefs.js`). Has **no upload rate limit or `disableUpload` control** (`btDownloadSpeedSoftLimit`/`HardLimit` only throttle download via `swarm.pause()`). Disk cache only.
  - **Maturity**: `stremio-service` `v0.1.22`, 39 open issues (`11` `stream`, `4` `windows`); `enginefs` 4 open issues.

---

## 5. Custom Go sidecar over `anacrolix/torrent` (and `anacrolix/confluence`)

**Primary sources**: [`anacrolix/torrent`](https://github.com/anacrolix/torrent) (`v1.62.0`), [`anacrolix/confluence`](https://github.com/anacrolix/confluence).

Because `TorrServer` derives its streaming power from `anacrolix/torrent` while inflating binary size and side effects with unrelated features (WebUI, Swagger, Telegram, DLNA, sorted 1-based file IDs), a minimal custom Go sidecar (e.g., ~200–400 LOC wrapping `anacrolix/torrent` + `http.ServeContent`, or embedding `confluence` handlers) is a distinct, cleaner candidate.

- **Licence & ADR-0004**: `MPL-2.0` without Exhibit B (`anacrolix/torrent/LICENSE`). `MPL-2.0` is compatible with `GPL-3.0-or-later` (`MPL-2.0 §3.3`); distributing a bundled Go sidecar in the NSIS installer is allowed (provide source availability for the `MPL-2.0` library modifications, if any, and our Go sidecar code).
- **Build, native deps, size**:
  - Go `1.26.0` (`go.mod`). Pure Go (`CGO_ENABLED=0`) static `.exe` when using pure-Go storage (`storage.NewFile`, `bolt`, `filecache`, or a custom RAM/disk ring buffer; avoid `sqlite`/`possum` CGO backends).
  - Requires adding the Go toolchain to `docker/dev.Dockerfile` and Windows CI (`scripts/windows/build.ps1`), with zero MSVC or runtime DLL interaction.
  - **Size `[inference]`**: Based on shipped `CGO_ENABLED=0` `anacrolix/torrent` Windows binaries (`Gopeed-v1.9.3-windows-amd64.zip` at **25,956,988 bytes / ~24.8 MiB** zipped, and `TorrServer` `Silo.2` at **35,936,768 bytes / ~34.3 MiB** raw exe), a stripped headless sidecar adds **~25–36 MiB** uncompressed (~10–15 MiB inside NSIS LZMA/ZSTD).
- **Streaming while downloading**:
  - `File.NewReader()` / `Torrent.NewReader()` returns `io.ReadSeekCloser` (`reader.go:18`) with `SetReadahead(bytes)` / `SetReadaheadFunc` dynamically shifting a prioritized read-ahead window on every `Read`/`Seek`, and `SetResponsive()` (`reader.go:95-115`) prioritizing earliest unread bytes over rarest-first.
  - Plugs directly into Go stdlib `http.ServeContent` for `206 Partial Content` `Range` serving (exactly what `TorrServer` and `anacrolix/confluence`'s `GET /data` + `?file=` do). Sidecar only — no in-process mpv callback.
- **File selection, `infoHash`, magnet URI, tracker list**:
  - `TorrentSpec` directly accepts `InfoHash` (v1), `InfoHashV2` (v2), `Trackers [][]string`, and `Sources []string` (`client.go:1650+`), alongside `AddMagnet` and `AddTorrentInfoHash`.
  - `t.Files()[idx]` indexes directly by **0-based** metainfo index — exact match for Stremio `fileIdx`.
- **Network**:
  - `NewDefaultClientConfig()` (`config.go:322-360`) enables DHT, PEX, HTTP/UDP/WebSocket trackers, uTP (`go-utp`), UPnP (`anacrolix/upnp`), and optional LPD.
  - Default `ListenPort: 42069`; setting `ListenPort: 0` uses an ephemeral port, and `AcceptPeerConnections = false` forces outbound-only. Strong NAT traversal via uTP.
- **Upload control**:
  - `ClientConfig.UploadRateLimiter *rate.Limiter` (bytes/sec token bucket, `config.go:142`).
  - `Seed` defaults to `false` (stops altruistic seeding once download completes); hard upload stop via `ClientConfig.NoUpload = true` (`config.go:133`) or per-torrent `TorrentSpec.DisallowDataUpload = true` (`client.go:1717`).
- **Storage**:
  - Pluggable `storage.ClientImpl` (`storage/interface.go`):
    1. `storage.NewFile` / `NewFileByInfoHash`: disk files (mmap or classic I/O + partfiles); `t.Drop()` synchronously waits for storage close (`wg.Wait()`, `t.go:114`) so `os.RemoveAll` deletes cleanly on stop.
    2. `storage.NewResourcePieces` (`filecache`): LRU capacity-capped disk cache (as used by `confluence`).
    3. Custom RAM/disk sliding-window cache (like `TorrServer`'s `torrstor.Cache`) evicting behind the reader so a 60 GiB remux never fills disk.
- **Runtime reporting**:
  - `t.Stats()` (`TorrentStats`: `AllConnStats` read/written/wasted bytes + `TorrentGauges` `TotalPeers`/`PendingPeers`/`ActivePeers`/`ConnectedSeeders`/`HalfOpenPeers`/`PiecesComplete`, `torrent-stats.go:9-36`), `t.PieceStateRuns()` / `t.PieceState(i)` (`t.go:53-67`), `t.PeerConns()`, and `t.KnownSwarm()`.
- **Maturity**:
  - `anacrolix/torrent`: **6,133 stars**, `v1.62.0`, **61 open issues** (`6` `stream`, `4` `windows`). Production users include `TorrServer` (via `tsynik/torrent` fork), `Gopeed` (`GopeedLab/gopeed`), `anacrolix/confluence`, `Toru`, `bitmagnet`, and `distribyted`.

---

## 6. Supplemental Rust check: `irontide`

Checked for other pure-Rust `infoHash`-to-stream crates: **`irontide`** `v1.7.0` (`https://codeberg.org/alan090/irontide`, [`crates.io/crates/irontide`](https://crates.io/crates/irontide)) is `GPL-3.0-or-later`, `#![forbid(unsafe_code)]`, `edition = "2024"`, exposes `session.open_file(info_hash, idx) -> FileStream` (`AsyncRead + AsyncSeek`), uTP + DHT + PEX + NAT (`UPnP`/`NAT-PMP`/`PCP`), and `DiskStorage`/`MemoryStorage`. However, it has **low maturity** (**1,530 total crates.io downloads**, 665 recent; Codeberg repo was unreachable anonymously during this check; default `crypto-aws-lc` feature also hits the Windows NASM requirement unless switched to `crypto-openssl`), and no known production media streaming deployments.

---

## Side-by-side comparison

| Criterion | `librqbit` (in-process Rust) | `libtorrent-rasterbar` + Rust FFI | `TorrServer` (bundled Go) | `stremio-service` / `server.js` | Custom Go (`anacrolix/torrent`) |
| --- | --- | --- | --- | --- | --- |
| **Licence & GPL-3.0 + mpv (`ADR-0004`)** | `Apache-2.0` — compatible | `BSD-3-Clause` (`lt-rs` `MIT`; `rbtorrent` `GPL-3.0-only` ❌) | `GPL-3.0` — compatible (bundle source/offer) | `server.js` proprietary, `enginefs` unlicensed ❌ | `MPL-2.0` — compatible |
| **NSIS installer redistribution** | Allowed | Allowed (with chosen FFI/OpenSSL terms) | Allowed | **Not permitted** ❌ | Allowed |
| **Builds on Win MSVC (Rust 1.99) + Linux container** | Yes (`default-tls` needs no new system deps; avoid `rust-tls`/`aws-lc-rs`) | Upstream yes; **no existing Rust crate builds on MSVC** (needs custom `cxx` + Boost) | Needs Go `1.25+` in CI/container (or pinned release binary) | Prebuilt/Node + `ffmpeg`; moot due to licence | Needs Go `1.26+` in `dev.Dockerfile` & Windows CI (`CGO_ENABLED=0`) |
| **Installer size impact (uncompressed)** | ~5–10 MiB `[inference]` (`rqbit.exe` 12.2 MiB) | ~5–12 MiB `[inference]` (wheel 4.8 MiB) | **60.9 MiB** (`MatriX.150`) / 34.3 MiB (`Silo.2`) | 75.2 MiB (`v0.1.22` zip 29.4 MiB) | **~25–36 MiB** `[inference]` |
| **Streaming: piece priority + HTTP `Range` / mpv callback** | 32 MiB seek window + `AsyncRead + AsyncSeek` + optional Axum HTTP `206` | `set_piece_deadline` + `read_piece`; Host must write HTTP/mpv bridge | Fixed 16 MiB `torrstor` + HTTP `Range` (`206`) | `torrent-stream` sequential + HTTP `Range` (`206`) | Dynamic `SetReadahead` + `SetResponsive` + Go `http.ServeContent` (`206`) |
| **0-based file index / `infoHash` / magnet / trackers** | 0-based `only_files`; BTv1 only; `opts.trackers` skipped on `magnet:`/`infoHash` | 0-based `prioritize_files`; v1+v2; trackers ok | **Sorted 1-based `Id`** (mismatch w/ Stremio `fileIdx`); pulls external trackers | 0-based `/:infoHash/:idx`; `?tr=` | 0-based `Files()[idx]`; v1+v2 `TorrentSpec` w/ `Trackers` & `Sources` |
| **DHT / PEX / trackers / uTP / UPnP / NAT** | All present; uTP & UPnP **off by default**; UDP tracker binds at startup | All **on by default**; mature uTP NAT traversal | All present; runs external public-IP/DNS/tracker fetches | DHT + PEX + trackers; **no uTP or UPnP** | All present (`NewDefaultClientConfig`); `ListenPort: 0` or outbound-only |
| **Upload control** | Token-bucket bps + `disable_upload` runtime & feature flag | `set_upload_limit`; stop needs `unchoke_slots_limit = 0` | `UploadRateLimit` KB/s + `DisableUpload` (`NoUpload`) | **None** | `UploadRateLimiter` + `Seed = false` + `NoUpload` / `DisallowDataUpload` |
| **Storage & delete on stop** | Sparse disk files; **keeps whole file** (needs patch to evict); `delete(id, true)` | Mmap sparse + `.parts`; **keeps whole file**; `delete_files` | **64 MiB bounded RAM** or disk cache (evicts behind reader) | Disk cache only; `/remove` | Disk, `filecache` (LRU cap), or custom bounded RAM/disk ring; `Drop()` + remove |
| **Reporting (peers, rates, pieces, errors)** | Rich `TorrentStats` + peer breakdown + `error` | Rich `torrent_status` + typed alerts + piece bitfields | Coarse JSON (`stat`, speeds, peer counts, `/cache` map) | `stats.json` | `TorrentStats` + `PieceStateRuns` + `PeerConns` + `KnownSwarm` |
| **Maturity (stars / open issues: stream, win / prod)** | 1,995★ / 103 (9 stream, 6 win) / `rqbit`, `ventic`, `torrentplayer` | C++: 6,128★ / 228 (24, 48) qBittorrent; Rust FFI: immature | 3,234★ / 18 (3, 3) / Android TV, Kodi, Lampa | 39 (`stremio-service`, 11, 4) — unlicensable | 6,133★ / 61 (6, 4) / `TorrServer`, `Gopeed`, `confluence`, `Toru` |

---

## Facts that decide between in-process and bundled sidecar

The decision in [#293](https://github.com/MenotiFilho/streamingapp/issues/293) turns on these trade-offs rather than missing protocol features:

1. **Workspace runtime and `unsafe_code = "forbid"` (`Cargo.toml:49`)**:
   - **In-process (`librqbit`)**: Introduces a `tokio` multi-threaded async runtime (~80+ crates) into a Host that is today synchronous (`ureq` + OS threads). Serving mpv via a tiny localhost HTTP `Range` endpoint keeps `host-mpv` free of `unsafe`; wiring `FileStream` directly into `libmpv2::protocol::Protocol::new` would require carving out an `unsafe` FFI wrapper.
   - **Bundled sidecar (Go)**: Leaves the Rust Host synchronous and `unsafe`-free; the Host talks to the sidecar strictly over localhost HTTP and process stdio/signals.

2. **Toolchain, CI, and binary footprint (`docker/dev.Dockerfile`, `scripts/windows/build.ps1`)**:
   - **In-process (`librqbit` w/ `default-tls`)**: Builds today in both `docker/dev.Dockerfile` and Windows MSVC Rust `1.99` with **zero new toolchains or system packages**, adding **~5–10 MiB** uncompressed `[inference]`. (By contrast, `libtorrent-rasterbar` in-process forces Boost + C++17 + custom `cxx` FFI maintenance.)
   - **Bundled sidecar (Go `anacrolix/torrent` or `TorrServer`)**: Requires installing Go (`1.25+`) in `docker/dev.Dockerfile` and Windows CI (or fetching pinned binaries during build) and adds **~25–36 MiB** (custom Go sidecar `[inference]`) or **~61 MiB** (`TorrServer MatriX.150`) uncompressed to the installer.

3. **Disk usage and bounded buffering on large Streams (4K remuxes)**:
   - **In-process (`librqbit` unmodified)**: Prioritizes a 32 MiB lookahead around playback, then continues filling disk with the rest of the selected file until stopped (`delete(id, true)`). Bounded ring-buffer eviction behind the reader requires patching `librqbit` (as `ventic` does) or implementing a vetted custom `StorageFactory`.
   - **Bundled sidecar (`TorrServer` / custom Go over `anacrolix/torrent`)**: `TorrServer`'s `torrstor.Cache` already runs inside a fixed **64 MiB RAM** or bounded disk cache, evicting watched pieces automatically; a custom Go sidecar can reuse `filecache` or a bounded ring storage with clean `Drop()` teardown.

4. **NAT traversal, Windows firewall hygiene, and upstream stability**:
   - **In-process (`librqbit`)**: `default` disables uTP (`TcpOnly`) and UPnP, and binds a UDP tracker socket eagerly at startup (triggering Windows Firewall prompts); `v9.1.0` just fixed a Windows UDP recv crash (`WSAEMSGSIZE`/`WSAECONNRESET`) in DHT.
   - **Bundled sidecar (`anacrolix/torrent` / `TorrServer`)**: Ships mature uTP + UPnP enabled by default, though `TorrServer` unpatched performs extra startup DNS/public-IP/trackerlist calls and renumbers files 1-based sorted alphabetically — whereas a custom Go sidecar gives exact control over 0-based `fileIdx`, ports, outbound-only mode, and process shutdown.

5. **Process lifecycle vs. in-process ownership**:
   - **In-process**: Crash/hang domain is shared with the Host, but cleanup (`delete(id, true)`), bandwidth/upload limits, and per-peer diagnostics are direct Rust calls with zero orphan-process risk on forced exit.
   - **Bundled sidecar**: Crash-isolated from the Host and mpv, but requires Windows Job Object / parent-watch cleanup so a killed Host never leaves a seeding process or locked files/ports behind, plus localhost port allocation and secret/loopback binding so other local/LAN clients cannot hijack the control port.
