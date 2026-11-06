# Keeping mpv's window up so a Stop leaves no hole (#250)

The owner reported that closing a Stream from the served Remote still left the
window transparent for a moment: the desktop showed through where the picture had
been, until the shell repainted. The same hole could be seen on a Stream that
ended or failed on its own. The fix that holds in every one of those cases is to
stop mpv destroying its video output at all: `force-window` keeps the child
window `wid` named alive and black while no Stream is playing.

## The hole

The Host's window is `transparent: true` (`src-tauri/tauri.conf.json`), and the
page stops painting its own rectangle exactly while playback is not `idle`
(`pictureBehind` in `src/core/playback.ts`). The picture that shows through is
mpv's child window, created inside the Host's window by `--wid` (ADR-0003,
ADR-0013, `crates/host-mpv/src/lib.rs`).

mpv uninitialises the video output when a file is unloaded and no video is
playing, unless something keeps it up. So:

- a Stop taken in the window is survivable: `takeWithStop` (`src/window/Shell.tsx`)
  paints the shell's ink *before* the Action leaves, and gives the picture back
  only if the Host refuses the Stop;
- a Stop taken from a Remote goes straight to the Host (`ValidatedAction::StopPlayback`,
  `crates/host-core/src/host.rs`), which calls `Player::stop` and only then
  publishes `idle`; the page, still transparent, has nothing behind it while
  mpv tears its child down and the Snapshot travels back;
- a Stream that reaches its end keeps its last frame (`keep-open=yes`), but one
  whose open fails can leave no child where the page is already transparent.

## The evidence for the choice

mpv's own manual:

- `--force-window=<yes|no|immediate>` — "Create a video output window even if
  there is no video. This can be useful when pretending that mpv is a GUI
  application." The window is created after initialization; `immediate` creates
  it at program start. (<https://mpv.io/manual/master/#options-force-window>)
- `--idle` — mpv waits instead of quitting when no file is playing
  (<https://mpv.io/manual/master/#options-idle>). Idle alone closes the video
  output window; the pair `--idle --force-window` is the recipe a worked example
  gives for keeping the window open after playback ends
  (<https://www.baeldung.com/linux/mpv-player-prevent-closing>).
- `--background-color` — "Color used to draw parts of the mpv window not covered
  by video in `--background=color` mode." The default is black
  (<https://mpv.io/manual/master/#options-background-color>). The option is the
  guarantee that the kept window is black rather than the last frame.
- `--wid` — draw into an existing window; `--geometry` is ignored when it is
  set, which is why the app shell's adoption thread keeps the child the size of
  the Host's client area (`src-tauri/src/player/windows.rs`).
  (<https://mpv.io/manual/master/#options-wid>)

mpv's builtin pseudo-GUI profile is the same recipe — `force-window=yes` with
`idle=yes` — and a worked example of `--idle --force-window` says playback stays
idle "with the video output window open after the video ends"
(<https://github.com/mpv-player/mpv/blob/master/etc/builtin.conf>,
<https://www.baeldung.com/linux/mpv-player-prevent-closing>).

`yes` rather than `immediate`: the window only has to outlive a Stream, and
`immediate` would create the child before the first Stream, on top of the
WebView2 until the adoption thread pushes it down. With `yes` the first child is
created when the first Stream starts and then stays; the adoption thread's poll
is unchanged, it just finds the same child every time.

## Decision

`host_mpv::options` gives `Placement::InWindow`:

- `force-window=yes` — the video output, and the child window `wid` named, stay
  up after a stop, an end and a failed open;
- `background-color=#000000` — the kept window is black.

The page's ink covers the black at rest; while the picture is behind, mpv's
window is still there. No Snapshot field, no extra Action and no client-specific
path is added: the fix is below the Player seam and therefore the same whether
the window or a Remote asked for the Stop.

Rejected: **telling clients the picture is leaving before tearing mpv down** (a
new Snapshot field, read by `pictureBehind`, published between the Stop and
`idle`). It would make a Stop from any client reachable, but a Stream that ends
or fails has no earlier moment the Host can announce — the end arrives in
`sample`, after mpv has already let the file go — and every client would have to
learn a new state for a hole that the Player can simply not open.

Test: `a_host_window_is_kept_up_and_black_while_idle`
(`crates/host-mpv/src/lib.rs`) — the option list is the decision, and the
headless integration suite drives a real mpv with `vo=null`, so the window
itself is not observable there.

## What only the Windows by-hand check can confirm

- With a real `wid` child: a Stream playing, then **Stop from the Remote** —
  the window never shows the desktop between the press and `idle`; then a Stream
  that reaches its end, and an open that fails, with the same result.
- The kept child is black, not the last frame, and does not show mpv's own idle
  OSD over the page while the shell's ink is up.
- The child is still pushed behind WebView2 and sized to the client area after
  the Stop (the adoption thread keeps running), and the window's resize still
  tracks.
- Nothing about the picture changes on the Windows-native build: HDR passthrough
  and hardware decode are not verifiable in the container, which has no GPU.
  `force-window` only keeps the video output alive; `vo=gpu-next`, `wid` and
  `target-colorspace-hint` are untouched.
