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

- **`librqbit` in-process.** The best Rust fit and Apache-2.0, but unpatched it
  keeps downloading the rest of the file and evicts nothing behind the reader, so
  the bounded cache of §3 would be a fork to maintain; and it binds UDP at start,
  which raises the Windows firewall alert at launch rather than at the first
  torrent (story 20).
- **`TorrServer`.** GPL-3.0 and eligible, but a large program with its own web
  UI, database and side effects, and its own idea of what is kept.
- **`stremio-service` / `server.js`.** Disqualified: `server.js` is proprietary
  and unlicensed, so it cannot be shipped.
- **`libtorrent-rasterbar`.** The best piece scheduler, but the Rust bindings do
  not build on MSVC or expose the streaming API, and a custom FFI crate plus Boost
  in the dev image and the Windows build is more than the engine is worth.
- **A libmpv custom protocol.** It would put the swarm inside the Player's
  process through an `unsafe fn` callback, against ADR-0013 and the Host's rule of
  no `unsafe`.
- **A loopback control API.** A second protocol, with a port and a lifetime of its
  own, where stdio's lifetime is the pipe's.
- **Go on Windows** as a toolchain: it would put a second toolchain on a machine
  the walkthrough already needs only Rust for.
- **A separately published binary.** The owner would have to install it, and the
  installer is the only thing they run (story 2).

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

- **A second Provider.** A Provider answers for a Video, and the engine answers
  for no Video: it would have to be invented candidates, and every consumer of the
  Streams list would then have to know which kind they came from.
- **Inside the Player.** The Player is the Stream playing now, and a fake Player
  should not have to pretend to join a swarm (the argument ADR-0028 made for the
  Previewer).

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

- **A RAM ring.** A 60 GB remux needs a read-ahead the owner can set, and a ring
  big enough to survive a seek is bigger than memory a Host should take.
- **The whole file on disk.** A 60 GB remux fills the drive; the cache is a bound
  the owner chooses.
- **A cross-torrent LRU.** It would keep what the owner stopped watching, which is
  a download nobody asked for (story 14).
- **An upload limit, or a cap on it.** Held only while watched, upload is the
  price of the swarm; a limit would make the Host a worse peer for a feature the
  owner did not ask for.
- **Lazy re-join** of a let-go torrent. It would keep a half-held torrent that
  neither uploads nor is deleted, and make two states of what is simply held or
  not.
- **A derived or fixed disk ceiling.** The owner's disk is the owner's to size.
- **Validation coupled to the Stream buffer.** The two preferences are told to the
  engine as limits and the engine clamps read-ahead to 3/4 of the cache, so no
  rule between them is the Host's to refuse.

## 4. Which file of a torrent plays

**The engine chooses, after metadata, behind the URL it already gave out, from the
Host's hints:** `fileIdx`, `behaviorHints.filename`, and the Video's season and
episode. A `fileIdx` is trusted only when it is in range and points at a video.
The rule, in order: the filename hint, then video extensions, then the episode
match, then the largest file. It fails, with a sentence, when the episode is
missing among several videos or there is no video at all. The owner is never asked.

Rejected:

- **The Host choosing.** It would need the file list sent back over stdio before
  the Player opens, which breaks the answer-at-once of §2.
- **Always trusting `fileIdx`.** Addons point at the wrong file, and a `fileIdx`
  at a subtitle or an `.nfo` plays nothing.
- **The largest file regardless.** In a season pack that is the wrong episode and
  records Watch progress against it.
- **A file list for the owner.** The owner pressed Play on a Stream; a second
  question is a regression from the Streams picker.

## 5. What a client is told while a torrent waits

- A **Torrent status** (finding or fetching, peers, rate) in the playback
  Snapshot, and **Stalled** for every Stream, torrent or not.
- The Host gives up **only while opening**: 60 s with no metadata, or no peers,
  gives "Nobody is sharing this torrent right now." Mid-play it never gives up.
- A crashed engine is restarted **once** and the Stream reopened at its position;
  a second exit during the same Stream ends it. A storage error ends it at once.

Rejected:

- **Phase only, or no status.** The owner cannot tell a dead torrent from a slow
  one.
- **Three phases** (metadata, connecting, fetching). The owner's decision is wait
  or leave, and two phases carry it.
- **Folding into Statistics.** Statistics is something the owner opens; the wait
  is something they are in.
- **A torrent-only stall.** A held picture looks the same for any Stream, and the
  Player already reports it (`paused-for-cache`).
- **A mid-play give-up, or never giving up.** The first ends a Stream that would
  have recovered; the second leaves an opening that cannot (story 8).
- **Ending on the first crash, or restarting without limit.** The first costs the
  owner their place for a fault the Host can repair; the second loops on one that
  it cannot.

## 6. No Seek preview for a torrent

A torrent's loopback URL has one reader the cache is built around, and the
preview's second reader would ask for pieces far from it, compete with playback for
peers and sit outside "evict behind the reader". So the Host **never arms the Seek
preview for a torrent** (ADR-0028): `preview(at)` answers absent and both clients
draw time and Chapter. **Resume is unchanged** — ADR-0015's first-playable rule
holds, torrent or not.

Rejected:

- **Armed on held pieces only.** A still of a held piece is mostly a still of the
  beginning and the last place watched, which is not what a scrub bar asks.
- **Armed normally.** The competing reader described above.

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
