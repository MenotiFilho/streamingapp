# The Seek preview is a second, silent Player, and it may only run on a Stream we can afford

Ticket #140: pointing at the timeline says what time it is and nothing else. A
poster is metadata and an episode still is somebody's artwork, so the still has
to come from the Stream itself — and the Stream is a URL a debrid Addon minted,
one file, with no sprite sheet and no transcode endpoint in the addon protocol.

A second libmpv instance is the only way to get a frame from a moment other than
the one being played. This records that instance, the two brakes on it, and why
the alternatives are worse.

## The facts this rests on

Probed in the dev container against **mpv 0.37.0 / FFmpeg 6.1.1 / libmpv2 6.0.0**
(`docs/research/` holds the surrounding material; these numbers came from a
throwaway spike crate, since deleted, driving the real library), and read from
mpv's manual for the behaviour the container cannot reach:

- `screenshot-raw` at `vo=null` answers a real `MPV_FORMAT_NODE_MAP` —
  `{ w, h, stride, format: "bgr0", data }` — with distinct, non-black frames at
  different timestamps. But `libmpv2` exposes only `Mpv::command`, which returns
  `Ok(())` and frees the result node; the crate has no `command_node`, no node
  property type and no public handle. The workspace forbids `unsafe`
  (`Cargo.toml:64`), and the one exception is Win32 in the app shell, not a media
  stack.
- `screenshot-to-file` writes at `vo=null`: ~2.4 ms for a 128×72 still, real and
  different per timestamp. JPEG is already mpv's default format.
- **A screenshot taken right after `seek` returns the previous frame.** `seek`
  returns in 0.03 ms with `time-pos` already at the target; the frames only
  change after `MPV_EVENT_PLAYBACK_RESTART` (~3 ms for a local file, ~27 ms once
  a filter chain is installed). Every probe that shot immediately got 0 differing
  bytes; every probe that waited for the event got the new frame (6 of 6).
- `vf=scale` applies **before** the screenshot: 640×360 becomes a 320×180 still,
  and the capture cost falls from 3.8 ms to 0.2–0.4 ms at 64×36. `width` and
  `height` keep reporting the decoder size, so the filter is invisible to the
  rest of the reading.
- `zscale` and `tonemap` exist in the build, so an HDR frame can be brought to
  BT.709 before it is encoded.
- Two libmpv instances coexist in one process with empty stderr; ffmpeg's CUDA
  probe is logged once per process, not once per instance.
- `demuxer-cache-state` is readable through the safe API as a string. But there
  is **no cumulative-bytes meter**: `total-bytes` is the cache's current
  occupancy, and `raw-input-rate` "may be inaccurate or missing" (mpv's words).
  A budget in bytes cannot be enforced honestly.

## 1. A second Player, and not the one on screen

The moment the owner points at is not where the Stream is playing, so the main
instance cannot answer without seeking away from the picture. The preview gets
its own libmpv: `vo=null`, `ao=null`, `aid=no`, `sid=no`, `config=no`,
`idle=yes`, `keep-open=yes`, a small demuxer cache, and
`vf=scale=320:-2` — a 16:9 still of about ten kilobytes, which is what a tooltip
can afford and what a phone's socket can carry.

It is a **`Previewer`** seam of its own (`arm`, `disarm`, `preview(at)`), not a
method on `Player`: the Player is the Stream playing now, and `FixturePlayer` and
`NoPlayer` should not have to pretend to produce frames. `HostView` carries it
beside the other seams, so a Question can read it outside the Host's lock
(ADR-0022).

## 2. Armed at `open`, connected on the first hover, released when idle

The Host keeps no URL of its own (`player.open(&url, …)` passes it through), so
the previewer is armed at the same moment the Stream opens. Arming costs nothing:
the worker does not connect until the first `preview(at)`.

The connection is the thing to ration. It stays open for **30 s** after the last
still and then releases the URL, so a burst of hovering pays one connection and a
later burst pays another. Two hundred stills stay in memory (~2 MB) keyed by
bucket, so returning to a second already seen costs nothing at all.

## 3. The ceiling: 20 Mbps, and a bitrate nobody states refuses

The URL is a debrid session. Some providers allow one connection at a time,
others count a second one against the account, and the Host cannot know which
before trying. So the worker is a decoration that must never compete with the
film:

- known `video-bitrate` above **20 Mbps** — never armed (`video-bitrate` is
  already read, `host-mpv/src/lib.rs`, and already published as `Statistics`);
- known and below — armed;
- **zero or absent — refuses.** There is no cumulative-bytes meter to bound an
  unknown-bitrate worker, so the only honest rule is not to start one. A log line
  counts how often this happens; the decision can be reopened with that data.

Rejected: the byte budget this ADR originally proposed — `total-bytes` is current
occupancy and `raw-input-rate` is explicitly unreliable, so the number would have
been fiction with the shape of precision.

## 4. The frame leaves mpv through a file

`screenshot-raw` is the better transport and the safe crate cannot read it. So
`preview(at)` seeks, waits for the event, calls
`screenshot-to-file <temp>/<bucket>.jpg`, reads the file and deletes it. The
directory is the process's own temporary directory (not `/tmp`, which does not
exist on the Windows build), one file per in-flight capture.

Rejected: **raw pixels through `libmpv2-sys`** — it works, and it would need a new
crate outside the workspace's `forbid(unsafe_code)`, in the one place where a
mistake is a segfault in the middle of playback. The file costs a few milliseconds
and no unsafe at all.

## 5. Readiness is an event, never a position

`time-pos` is at the target before the frame exists, so the naive loop returns the
still of the moment before the seek and looks *almost* right — the worst kind of
wrong. The worker waits for `Event::PlaybackRestart` and gives up after **3 s**.
The timeout is a still that never comes, which is drawn as absence.

## 6. One bucket every five seconds, one request in flight

A seek costs the bytes between the target and its keyframe: about 5 MB at the
ceiling, more when the release has a long GOP. A request per second would be
300 MB for a minute of dragging; a five-second bucket is 60 MB and the still is
at most four seconds off the cursor, which nobody can see in a still frame.
The client keeps one request in flight and lets the newest one win; the worker
keeps one capture in flight and drops stale asks.

## 7. The eighth Question

A still is a Question ("what does the Stream look like at 42:10?"), answered to
the client that asked and published to nobody (ADR-0010, ADR-0022). `Preview {
at }` returns `Answer::Preview { at, image }`, so the window and the served
Remote reach it through the one door (ADR-0002) and the Remote is the window's
equal (ADR-0018). The Remote has no hover: it asks while a range drag is in
progress. That is the tactile equivalent of pointing, and it reuses the control
that is already there.

The vocabulary of "the seven questions" becomes eight when #140 lands, wherever
it is written — `is_question`, the door's own comment and ADR-0022 included.

## 8. A failure is silence

A Stream that will not open, a seek that times out, a provider that refuses the
second connection: each is one log line, no Snapshot, no `failure`, and no effect
on playback. A preview is decoration; it may never make a film stop, and a
debrid provider's policy is not something a client should be told about through
the player.

## 9. HDR is tonemapped

The app exists to pass HDR through untouched, which is exactly why a frame that
leaves the Player without conversion must not be shown: a PQ/BT.2020 still drawn
into an `<img>` is grey and washed out, and it would be the only part of the
product that looks broken on the content the product is for. When the worker's
own `video-params` say the frame is HDR, a `zscale` + `tonemap` chain brings it to
BT.709; SDR passes through and pays nothing.

## Rejected, with reasons

- **Capturing the playing instance** — free on the network, and it would cover
  only what has already played. `vf=snapshot` does not exist in mpv 0.37 and
  labelled `--vf` graphs do not parse, so the cheap version of that design needs
  a full-resolution screenshot (encoded on the core thread, one dropped frame
  each time) plus a Rust-side downscale. A reduced half of the feature at a cost
  the user feels every ten seconds.
- **The 720p sibling candidate** — the same second of another encode is another
  frame, another intro and sometimes another runtime, and `PlayStream` carries one
  candidate (ADR-0013). A still that is not of this Stream is a lie with a
  timestamp.
- **A pre-computed sprite sheet** — hundreds of seeks per film against a debrid
  account, for a tooltip.
- **A preference for the ceiling** — a safety valve is not a feature. The
  Settings surface it would add (store, two clients, a spliced list, chips,
  tests) is larger than the thing it configures.
- **Reading only while the OSD is up** — the worker would open and close on every
  appearance of the bar, which is more connections, not fewer.
- **A window-only Tauri command** — the first capability the window would have
  that a Remote could not, against ADR-0018 and the comment at the top of
  `src-tauri/src/ipc.rs`.

## Consequences

- A preview may hold a second connection to a debrid URL for up to 30 s after the
  last hover, and may fetch a few megabytes per distinct point. It never runs on a
  Stream above 20 Mbps or on one whose bitrate is unknown.
- The container proves the mechanism (seek, event, capture, two instances,
  distinct frames) and the parser, but not the colour and not the provider: HDR
  tonemapping, `screenshot-to-file` on mpv 0.41, the `zscale` filter in that
  build, and a second connection against a real debrid link are Windows
  walkthrough items.
- The window and the Remote both draw the tooltip, so a change to the bucket or
  the still's shape is one change in the Host plus two drawings.
- `CONTEXT.md` gains **Seek preview**, and the **Player** entry now says which
  frames cross the seam. The **Buffered** reading (#139) is what the preview
  agrees with: a still exists for a moment the worker could reach, not for every
  pixel of the bar.
