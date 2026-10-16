# The control set, mpv facts verified in the dev container

**Date:** 2026-10-16. **Where:** the dev container (Ubuntu 24.04, mpv 0.37.0,
libmpv client API 2.2.0, no display and no GPU), by driving a real `mpv` over its
JSON IPC socket against generated media, then by asserting the same things
through `host-mpv`'s integration test (`crates/host-mpv/tests/mpv.rs`). Ticket
#28. Where a fact is version-shaped it says so; the Windows side runs 0.41.

Scope: what the Player seam needed to know for the full control set. Not in
scope: video output, HDR, audio devices, windowing — none of which this container
can answer (see `media-quality-hdr-audio-passthrough.md`).

Everything below was run with `vo=null ao=null` (the headless `Placement`), so a
fact here is a fact about a Player with nowhere to draw. Where that changes what
is answerable it is said so.

## How each control is read and set

| Control | Read | Set |
|---|---|---|
| tracks | `track-list/count`, then `track-list/N/{id,type,lang,title,codec,external,selected,default,forced}` | — |
| audio track | the `selected` flag on the `audio` track | `set aid <id>` |
| subtitle track | the `selected` flag on the `sub` track | `set sid <id>`; off is `set sid no`, which reads back as `false` |
| subtitle delay | `sub-delay` (f64) | `set sub-delay <seconds>` |
| speed | `speed` (f64) | `set speed <rate>` |
| volume / mute | `volume` (f64), `mute` (bool) | `set volume <level>`, `set mute yes\|no` |
| chapters | `chapter-list/count`, `chapter-list/N/{title,time}`, `chapter` (index) | `set chapter <index>`, `add chapter 1` / `-1` |
| crop | `video-crop` (string, `96x72+16+0`, empty when uncropped) | `set video-crop WxH+x+y` |
| aspect | `video-aspect-override` (f64; `0.0` means the source's own shape) | `set video-aspect-override <ratio>`, source is `no` |
| resolution | `width`, `height` | — |
| statistics | `video-bitrate` (i64), `frame-drop-count` (i64), `hwdec-current` (String) | — |
| external subtitle | the `external: true` track `sub-add` adds | `sub-add <url> [auto] [<title>] [<lang>]`; `sub-remove <id>` |

### The lists are read one property at a time

`track-list` and `chapter-list` are mpv *node* properties, and the safe crate the
Host uses (`libmpv2` 6.0) implements `GetData` for `f64`, `i64`, `bool` and
`String` only — not for a node or a JSON value. `unsafe` is forbidden in this
workspace, so the list is read through mpv's indexed property syntax instead:
`track-list/count` then `track-list/0/id`, `track-list/0/lang`, and so on. Both
`count` properties answer `0` with nothing loaded, so no special case is needed
for an idle Player. This was confirmed against a real file carrying two audio
tracks, two embedded subtitles and two chapters.

### `video-crop` cannot be cleared with `no`

`set video-crop no` fails with `MPV_ERROR_COMMAND` (`-12`) on mpv 0.41 — the
prototype's finding (`spike-windows-embedding.md`) — and the documented way to
restore the full frame is the empty rectangle: `set video-crop 0x0+0+0`
("overrides container crop and disables cropping", manual). On 0.37 that command
succeeds and the property then *reads back* as the string `0x0+0+0`, not as
empty — so the reading half has to treat a zero width or height as "uncropped",
which the seam does.

### The global subtitle language is mpv's own `slang`

`set slang <tag>` makes mpv select the matching subtitle track itself when a file
loads, and its matching is the part worth knowing: a bucket-language container
tag (`por`, `eng`) matches a BCP-47 preference (`pt`, `pt-BR`, `por-BR`), and
`en` matches `eng`. Verified for `pt`, `pt-BR`, `por`, `por-BR` (all selecting the
`por` track) and `en`, `eng` (both selecting `eng`). So the Host passes its stored
preference through unchanged and does not implement its own language matching.

`slang` has to be set *before* the `loadfile` that should use it, so the Host
tells the Player the preference at startup and at every change, not at `open`.

## What is answerable with no video output

- `video-crop`, `speed`, `volume`, `mute`, `sub-delay`, `video-aspect-override`,
  `chapter`, `aid`, `sid`: all set and read back exactly as they would with a VO.
  Crop in particular is a property the VO is asked to apply; setting it still
  succeeds and reads back with `vo=null`.
- `track-list` and `chapter-list`: complete — the demuxer reads them whether or
  not there is a picture.
- `video-bitrate`: **absent** with `vo=null` (no VO is counting bits).
- `frame-drop-count`, `decoder-frame-drop-count`: `0`.
- `display-fps`: absent. `estimated-vf-fps`: present (the filter chain's rate).
- `hwdec-current`: `no` (`vo=null` never engages hardware decode).

So a headless test can assert every control's property, and can assert
*statistics are reported* (a counting word for drops, a decode mode) without
asserting a number a `vo=null` machine cannot produce. The Windows walkthrough is
where the numbers are real.

## The stock autocrop script, headless

`TOOLS/lua/autocrop.lua` (what ADR-0003 calls the stock autocrop behaviour) was
run against a 128×72 clip with 16 px of black bar either side. It inserted
`cropdetect`, waited its `auto_delay` (4 s), then set `video-crop=96x72+16+0` —
the bars found and cropped, exactly as it does with a window. It works with
`vo=null`, and it clears a crop with `set file-local-options/video-crop ''`.

Two consequences for the seam:

- The script only runs when `playtime-remaining > auto_delay + detect_seconds + 1`
  (≈6 s), so a fixture shorter than that never gets cropped and a test that
  asserts autocrop must use a longer clip.
- It fires ~5 s after `file-loaded`, so a manual crop set before then is
  overridden by it — which is the script's own behaviour, not the Host's, and is
  what "stock" means.

## Not verified here (and where it is verified)

- **Anything windowed** (`wid`, z-order, click-through, the overlay): the
  Windows walkthrough (`scripts/windows/README.md`); #19 for Linux.
- **HDR passthrough, hardware decode engaged, frame pacing**: needs a display and
  a GPU; the Windows-native build, by hand. The *mode* statistic is answerable on
  Windows (`hwdec-current` is `d3d11va` there, `no` here), which is the half of
  it the statistics readout is for.
- **mpv 0.41 differences**: this container is 0.37 and Windows is 0.41. Every
  property and command above is long-standing; `video-crop`'s `no` spelling is
  already known to differ and is why the clear uses `0x0+0+0`.
- **`video-bitrate` and `display-fps` with a real VO.**

## Windows, verified by the walkthrough (#28)

The Windows-native build (mpv 0.41, a Radeon RX 9060 XT) ran the whole control
set over a real file on 2026-10-16. What the run settled, and what it did not:

- **Hardware decode is engaged, and it is `d3d11va`.** `hwdec-current` reads
  `d3d11va` once the picture is up, which is what the statistics readout shows and
  what the walkthrough asserts (a mode that is not `no`).
- **`video-params.pixelformat` is not answered in this configuration.** With
  `vo=gpu-next` embedded by `wid` it reads `unknown` — every time the decode line
  was written, including the one where the decode was already `d3d11va`. So the
  seam reports `pixelformat` as absent rather than inventing one, and no check
  anywhere asserts a pixel format on Windows.
- **`hwdec-current` is `no` for the moment before decode engages.** A line
  written once, at the first sight of the picture, therefore reports `no` and
  then never mentions the `d3d11va` that follows. The seam writes the decode line
  whenever what mpv decodes with *changes*, so both moments are in the log and
  the second one can be asserted.
- **The stock autocrop cropped the letterboxed fixture** on the GPU path exactly
  as it does headless: the picture is 1280x540 in a 1280x720 frame, and the bars
  are gone before the Host is asked to crop anything.
- **`pause` belongs to the player, not the file.** A Stream stopped while the
  picture was held was followed by one that opened held — a client asking to play
  got a Stream sitting at 0:00 offering Play. Opening a Stream means playing it,
  and the Player now clears `pause` before the load.
- **Not settled on Windows:** HDR passthrough (no HDR display on that machine,
  #18), and frame pacing beyond a raw screenshot.

