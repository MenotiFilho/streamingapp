# The Torrent engine is a bundled Go program the Host starts

Spec #311. Most Streams an owner's Addons return are torrents, and the Host has
listed an `infoHash` Stream as "Not playable yet" since ADR-0012 left the place of
the bridge open. This record decides how a torrent becomes bytes: which engine,
where it sits between choosing a Stream and the Player, what it keeps, which file
it plays, what a client is told while it waits, and what happens to the Seek
preview. Six decisions, each with the alternatives it rejected. (`0040` is
autoplay's and `0041` is the language fallbacks'; this one keeps `0042` whichever
lands first.)

## 1. The engine and its build

The **Torrent engine** (CONTEXT.md) is a Go program of our own over
`anacrolix/torrent`, built with `CGO_ENABLED=0` in `crates/host-torrent/engine/`,
**bundled beside `streamingapp.exe` and not linked into it**.

- The Host starts it **lazily**, on the first torrent played, and talks to it in
  JSON lines over stdio. It exits when its stdin closes, so a Host that exits,
  crashes or is killed takes it along.
- It serves the chosen file over HTTP `Range` on a **tokened `127.0.0.1` URL**,
  and `Player::open` takes that URL as it takes any other. So the Host has no
  `unsafe` code for it and no `tokio` (ADR-0009, ADR-0013), and `host-core` knows
  only the seam.
- Go is pinned in the dev image and the engine is cross-compiled there, so the
  suites keep running in the container (AGENTS.md).

**Licence (ADR-0004).** Our Go code is GPL-3.0-or-later. `anacrolix/torrent` is
MPL-2.0, and MPL-2.0 §3.3 allows the combination as a Larger Work under the GPL.
The installer carries the Go modules' licence texts.

Rejected:

- **`librqbit` in-process.** It needs no new toolchain, but it brings a
  multi-threaded `tokio` into a Host that is synchronous today, it fills the disk
  with the whole file unless it is patched or given our own storage, and uTP and
  UPnP are off by default.
- **`TorrServer`.** It is 61 MiB, numbers files 1-based in sorted order (Stremio's
  `fileIdx` would play the wrong file), calls outside services at startup and has
  an unauthenticated control API.
- **`stremio-service` / `server.js`.** Its licence forbids shipping it.
- **`libtorrent-rasterbar`.** No Rust binding builds on MSVC.
- **A libmpv custom protocol** (`libmpv2::protocol::Protocol::new`). It is an
  `unsafe fn` and would need a carve-out from `unsafe_code = "forbid"`; a loopback
  URL goes through the path the Player already uses for any URL.
- **A loopback HTTP control API guarded by a secret.** Stdio needs no control port,
  and the engine exits when its stdin closes, so no Job Object is needed.
- **Go on Windows** (a Go toolchain in `build.ps1`). The engine is cross-compiled
  in the container and carried to the Windows tree, so Windows needs no new
  toolchain.
- **A separately published prebuilt binary.** The same: the engine is built in
  the container and carried beside `libmpv-2.dll`, not fetched from elsewhere.

## 2. Where it sits: resolved before playback

This closes ADR-0012's open question ("resolving an `infoHash` before playback, or
answering as a source with playable candidates"): **resolved before playback.**

- A **`TorrentEngine` seam** in `host-core` sits between choosing a Stream and
  `Player::open`. It turns a chosen torrent into a loopback `StreamUrl`.
  `Playback::InfoHash` becomes `Playback::Torrent { info_hash, file_idx, sources }`.
- A torrent is therefore **playable everywhere a Stream is chosen** by the one
  rule, with no capability flag, and Now playing is unchanged.
- The seam answers at once and is bounded at about 5 s: the URL is given before
  metadata, and the file is chosen behind it (§4).
- The torrent is let go at stop or when a Stream from a *different* infoHash
  replaces it, and kept across `Ended` and across files of the same infoHash.

Rejected:

- **A second Provider.** Torrents still arrive inside Addon answers, and an engine
  that answered `FindStreams` would join a swarm for every listed candidate. The
  Provider's grain is one source's answer for a Video, which the engine is not.
- **Inside the Player.** It would couple `host-mpv` to swarms, and the Seek
  preview's second connection would need the same knowledge.

## 3. What the Host keeps of a torrent

- **A bounded cache on disk**, in the local data directory, sized by a Host
  preference (the **Torrent cache**, 2 GB by default) and deleted when the torrent
  is let go. **This is an exception to ADR-0026 §3** ("Memory, not disk"), for a
  torrent only: a direct Stream's bytes stay in the Player's memory.
- Pieces furthest behind the reader are given up first. Read-ahead follows the
  Stream buffer.
- **Nothing outlives the Stream.** The `torrents` directory is wiped at startup,
  and a storage error is treated as an engine failure (§5).
- **Unlimited upload, only while the torrent is held, and never seeding.**
- A torrent idle 10 min in `Ended` or 30 min paused is let go; Play brings it
  back at the held position.

Rejected:

- **A RAM-only ring** (about 64 MiB, as in TorrServer). A seek back fetches the
  pieces again, there is little for peers to download from us, and it spends RAM
  that mpv's own buffer (ADR-0026) already uses.
- **The whole file on disk.** A 60 GB remux fills the disk.
- **An LRU cache kept across torrents,** for an instant resume or rewatch. It needs
  a cap, eviction rules and gigabytes left on disk; a resume re-joins the swarm
  instead.
- **An upload-limit preference, or a fixed modest cap.** Upload is unlimited while
  the torrent is held and ends at let go.
- **The engine re-joining lazily on mpv's next read** after an idle let go. The
  engine would then hold state after a let go.
- **A disk ceiling derived from the Stream buffer (4x), or a fixed 2 GB; a
  read-ahead fixed in the engine.** The Torrent cache is its own preference, and
  read-ahead follows the Stream buffer.
- **Validating the two preferences together.** The engine clamps read-ahead to 3/4
  of the Torrent cache, so no rule between them is the Host's to refuse.

## 4. Which file of a torrent plays

**The engine chooses, after metadata, behind the URL it already gave out, from the
Host's hints:** `fileIdx`, `behaviorHints.filename`, and the Video's season and
episode. A `fileIdx` is trusted only when it is in range and points at a video.
The rule, in order: the filename hint, then video extensions, then the episode
match, then the largest file. It fails, with a sentence, when the episode is
missing among several videos or there is no video at all. The owner is never asked.

Rejected:

- **The Host choosing.** The file list would have to come back over stdio, so
  either the play waits for metadata inside the 5 s bound of §2, or a second
  round-trip happens after the URL is already out.
- **Always trusting `fileIdx`.** It would turn an Addon's mistake into a failed
  open.
- **The largest file anyway when the episode matches no file** (as `enginefs`
  does). It silently plays the wrong episode and records Watch progress and
  autoplay against it.
- **A file list for the owner.** It needs a new Level and Action, and a play that
  waits on a person.

## 5. What a client is told while a torrent waits

- A **Torrent status** (finding or fetching, peers, rate) in the playback
  Snapshot, and **Stalled** for every Stream, torrent or not.
- The Host gives up **only while opening**: 60 s with no metadata, or no peers,
  gives "Nobody is sharing this torrent right now." Mid-play it never gives up.
- A crashed engine is restarted **once** and the Stream reopened at its position;
  a second exit during the same Stream ends it. A storage error ends it at once.

Rejected:

- **Phase only, or nothing new.** `fetching` with 0 peers is how the owner reads
  "nobody sharing", so the peer count has to travel with the phase.
- **Three phases,** with a `connecting` step. It duplicates `peers = 0`.
- **Folding peers and rate into Statistics.** Statistics stays the Player's own
  report; the Torrent status has its own field, drawn while opening or Stalled and
  repeated in the Statistics panel.
- **A torrent-only stall** from the engine's reports, or no stall state at all.
  Stalled is read from mpv's `paused-for-cache` for every Stream, so one wait looks
  the same everywhere.
- **Also ending a stalled torrent mid-play after 60 s with no peers, or never
  giving up.** The owner sees the stall and stops, or picks another Stream; the
  Host gives up only while opening.
- **Ending the Stream at once on any crash, or restarting without limit.** A
  storage error is the exception that ends at once, because a full disk does not
  fix itself.

## 6. No Seek preview for a torrent

A torrent's loopback URL has one reader the cache is built around, and the
preview's second reader would ask for pieces far from it, compete with playback for
peers and sit outside "evict behind the reader". So the Host **never arms the Seek
preview for a torrent** (ADR-0028): `preview(at)` answers absent and both clients
draw time and Chapter. **Resume is unchanged** — ADR-0015's first-playable rule
holds, torrent or not.

Rejected:

- **Armed on held pieces only.** A second, no-fetch URL served from the Torrent
  cache. Previews would work behind playback and be absent ahead of it, which is
  inconsistent on screen, and it needs a no-fetch read mode in the engine.
- **Armed normally,** under the 20 Mbps rule of ADR-0028. Every scrub would be a
  second reader far from playback, and most stills would still time out (3 s).
- **Resume taking the same release first** (stream Addon plus `bingeGroup`, as Up
  next does). It would reverse ADR-0015's rejected alternative, and nothing about
  it is specific to torrents.
- **Resume taking direct Streams first and torrents last.** It overrides the
  Addons' order, which is the owner's ranking.

## Consequences

- `host-core` gains `torrent.rs` (the seam, `InfoHash` and the two fakes) and the
  Host carries a `TorrentEngine` beside its `Player` and `Previewer`, defaulting to
  one that refuses every serve. Nothing calls it until the slices after this one.
- The Windows installer ships a second program; its firewall alert appears once,
  at the first torrent played, never at launch.
- A torrent Stream is the one thing the Host writes to disk during playback, and
  the one thing it uploads.
- `CONTEXT.md` gains **Torrent engine**, **Torrent cache**, **Stalled** and
  **Torrent status**; **Stream**, **Provider** and **Stream buffer** are amended.
