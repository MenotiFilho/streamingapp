# libmpv facts, verified in the dev container

**Date:** 2026-10-16. **Where:** the dev container (Ubuntu 24.04, mpv 0.37.0,
libmpv client API 2.2.0, no display and no GPU), driving libmpv through a small
C program and then, for keeps, through `host-mpv`'s integration test
(`crates/host-mpv/tests/mpv.rs`). Windows 0.41 is a different build of the same
library, and where a fact is version-shaped it says so.

Scope: what the Player seam needed to know. Not in scope: video output, HDR,
audio devices, windowing — none of which this container can answer.

## How a Stream's progress is read

| Question | Answer (mpv 0.37, `vo=null ao=null`) |
|---|---|
| "Is a file loaded?" | `path` answers, and only while one is loaded. `time-pos` is unavailable while a file is being opened, and `pause` is readable whether or not there is anything to pause — so `path` is the one that says it. |
| "Has it started?" | `path` present: the position is answerable within ~200 ms of `loadfile`. Before that the open is in flight. |
| "Where is it?" | `time-pos` (seconds, `f64`), unavailable while opening, frozen while paused. |
| "How long is it?" | `duration` (seconds), absent for a Stream that does not state one. |
| "Is it held?" | `pause` — a boolean property. **`set pause yes` works; the `pause` *command* toggles and ignores its argument on 0.37**, so a pause sent to a paused player resumes it. The seam writes the property (`set pause yes` as a command, or `mpv_set_property`). |
| "Did it end?" | `eof-reached` — but only with `keep-open`. Without it mpv unloads the file at the end and `path`, `time-pos` and `duration` all go away. |
| "Did it fail?" | `end-file` with reason `error` (4) and `error` set (`-13`, `MPV_ERROR_LOADING_FAILED`) for both a file that does not exist and a URL nothing answers on. Nothing else reports it: the `loadfile` command returns success either way. |
| "What does it end for?" | `end-file` reasons seen: `eof` (0) at the end, `stop` (2) for `stop` and for a `loadfile … replace` replacing a playing file. A replacement's `stop` arrives *after* the command that replaced it, so nothing may be concluded from it alone. |

`keep-open=yes` is what makes "ended" observable rather than remembered: at the
end mpv pauses the player itself, keeps the file loaded, and leaves
`time-pos == duration` with `eof-reached=1`. Seeking back from there clears
`eof-reached` and holds the pause. The seam therefore asks `eof-reached`
*before* `pause`, or "ended" would read as "paused".

One wrinkle worth knowing for tests: `eof-reached` is set a moment before the
last of the audio is played, so the position at the first `ended` observation can
be short of the duration by a few hundred milliseconds. A test waits for the
end it settles at, not for the first word of it.

## What a failed open looks like, and what it does not

- A local path that does not exist, and `http://127.0.0.1:1/nothing.mkv`, both
  produce `start-file` → `end-file(reason=error, error=-13)` → `idle`, with no
  command ever returning an error.
- The mpv error is a *number*; there is no `mpv_error_string` in the safe crate
  the Host uses, so the seam names the few codes worth naming and keeps the
  number for the rest.

## Not verified here (and where it is verified)

- **Anything windowed**: `wid` embedding, z-order, click-through, transparency.
  Container has no display and no GPU; the Windows walkthrough is where this is
  checked by hand (`scripts/windows/README.md`), and #19 is where the Linux half
  is settled.
- **HDR passthrough, hardware decode, frame pacing**: no `/dev/dri`, no HDR
  display. Windows-native build, by hand.
- **mpv 0.41 differences**: the Windows side runs 0.41. The properties and
  commands this seam uses (`path`, `time-pos`, `duration`, `pause`,
  `eof-reached`, `keep-open`, `loadfile`, `seek`, `set`, `stop`) are long-standing
  and unchanged between 0.37 and 0.41 as far as the manual goes; `video-crop`'s
  `no` spelling — the prototype's other hard-won constraint — is 0.41 behaviour
  and not used by this ticket (#28's crop work is where it lands).
