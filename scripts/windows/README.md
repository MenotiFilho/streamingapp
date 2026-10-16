# The Host's window, on the Windows side

The dev container has no display and no GPU, so **the window is verified on
Windows**, reached from WSL. This directory is that route, written down so it is
run the same way twice:

- `stage.sh` — run in WSL: copies the tree to a Windows path, with the built frontend.
- `build.ps1` — run on Windows: fetches libmpv, makes it linkable, and does a
  release build of the app shell.
- `verify.ps1` — run on Windows: walks the window's manual checklist, asserting
  through UI Automation and screenshots each step into `evidence\`. Any subset of
  it can be walked on its own (`-Only`, `-From`, `-List`) — see "Walking part of
  the checklist" below.

The checklist covers the whole window: the preference and the Action surface, the
Addon by its manifest URL, the home surface's catalog rows, paging one, searching,
going Back, and the same controls reached with the arrow keys and OK rather than
the mouse (tickets #23 and #24), and — from #24 — opening a Title, a series'
seasons and episodes, backing out and opening the Title again, and — from #25 —
the TMDB key's round trip (entered, held, refused by TMDB without blanking a
Title, and cleared again), the backend the window says is holding it, and a
Title no TMDB record met marked unmapped. From #26 the walkthrough presses play
on a Video — an episode, or a film's own Play — and checks that the Streams
surface opens, that a candidate can be chosen, and that Back leaves it for the
Videos it was asked from; whether candidates actually arrive depends on the
Addon the run is pointed at, so walking the candidates themselves needs
`-Addon` naming an Addon that answers `stream` (Cinemeta, the default, answers
none, and the step says so rather than failing). From #27 the walkthrough goes
further when a candidate *can* be played: choosing one starts it, and the step
then checks that the picture is a window of mpv's own made a child of the Host's
window, that the interface's webview is above it, that a **real click in the
middle of the video** reaches the interface (the picture pauses, so the OSD
offers Play where it offered Pause), that play, pause, ±10 s and stop work
through the interface, and that Stop puts the client back on the list it chose
from. A run whose candidates are all `info_hash` — a torrent Addon with no
debrid configuration, say — checks the other half of the rule: the candidate is
listed, says it is not playable yet, and nothing is drawn for it. From #28 the
walkthrough walks the whole control set (step 13), over the fixture's own file:
the menu's groups are all asserted present, the file's two audio tracks and two
embedded subtitle tracks are listed (embedded first) and selectable by their
toggle state, a subtitle track is chosen and then turned off with `Subtitles
off`, the subtitle delay is stepped (`0.0 s` to `+0.1 s`) and reset, a speed is
picked and the pressed choice moves with it, the volume is moved and mute flips
the control to `Unmute`, the two chapters are stepped and jumped to, a crop is
applied and cleared over a file that really has black bars, an aspect ratio is
set and returned to `Source`, the statistics are shown and the readout names the
hardware decode mode, and — because an episode is what plays — `Next episode`
follows the fixture's series to the next one. From #29 the walkthrough watches
part of an episode, **kills the Host rather than closing it**, starts it again,
and picks the Video up from the Continue watching row: the row is there because
Watch progress is written while playback runs, and the resume plays from where it
was left rather than from the beginning. From #30 the walkthrough walks the
Stremio account: it starts with no account and **waits while the operator signs
in by hand** in the window's own form — the password is typed straight into the
password field and never passes through the script, a console, or a variable —
then checks the protection line says an account is held and that the `authKey` is
nowhere in the window, signs out again, and checks the log names no part of the
sign-in and the host exits through the hook sync added with `"account":false`. It
is runnable on its own with `-Only 24`; the merge and the push need a Title
watched while signed in, and `crates/host-core/tests/stremio_sync.rs` covers them
rather than a by-hand run that would push a fixture Title into a real account.
From #31 the walkthrough walks the remote: it checks the Host is serving and
announcing itself, reads the address and the pairing code off the window, and
then **waits while the operator pairs a browser on another device by hand** —
open the address, type the code, nothing passes through the script — before
checking that the device joined the list, that the code rotated, and that
revoking it on its own takes it off the list again. It is runnable on its own
with `-Only 25`, and it needs a second device on the same network (a phone is
the obvious one). The parts a phone cannot be asked to prove — an unpaired
connection reaching only the pairing exchange, and a revoked one being cut off —
are driven over a real socket by `crates/host-wire/tests/wire.rs`.

For the steps that depend on what a third-party Addon happens to serve — that
the posters are drawn, that a search returns something, which candidates a
Stream list holds — the assertion is structural (the rows stopped saying
`Loading`, the search surface is showing, the Title names the Addon that
answered, the revision did not move, a window class is or is not among the
Host's children) and the screenshot is the evidence a person reads. The one
thing these steps *cannot* walk is a Stream that fails to open: that needs an
Addon whose URLs are dead, so it is checked by the tests instead
(`crates/host-mpv/tests/mpv.rs` drives a real headless mpv at a URL that 404s,
and `src/App.test.tsx` renders the failure) — by hand, point `-Addon` at a
deaddressed Stream to see it.

The window is placed on `-Monitor` (1-based, numbered left to right) and filled to
that monitor's working area, so a run on a multi-monitor machine does not sit on
top of whatever else is being used and the screenshots show the Host rather than
whatever has the foreground. **Use the leftmost monitor (`-Monitor 1`)** — the
keyboard steps take the foreground away from whoever is typing, so a run anywhere
else interrupts them:

```sh
... -File 'C:\...\scripts\windows\verify.ps1' -Tree 'C:\...' -Monitor 1
```

This is a **by-hand walkthrough, not a test suite**. The spec's testing decision
stands: windowed behaviour is covered by manual checklists rather than GUI
automation in the build, so these scripts are run deliberately, never in CI.

## Walking part of the checklist

The whole checklist is 25 steps and takes minutes. To iterate on one step, run
just that one: the runner builds the ground the step declares first — an empty
data directory, one Host on `-Monitor`, the fixture Addon configured by manifest
URL, at the catalog rows — and reuses it when several selected steps need it, so
you never sit through the earlier steps to see whether step 13 works now:

```sh
# 1. the whole checklist, in order (what "The route, in full" below does)
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -Tree 'C:\...' -Monitor 1

# 2. what the steps are, and what each one needs, without starting a Host — the
#    discovery path, and the cheap syntax check
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -List

# 3. just the control set (step 13). It sets up first: one Host from an empty
#    data directory, the fixture Addon configured by manifest URL, at the rows.
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -Tree 'C:\...' -Monitor 1 -Only 13

# 4. from step 13 on: the control set, the Title, the series, paging, search,
#    the TMDB key, removing the Addon, the log and the data directory
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -Tree 'C:\...' -Monitor 1 -From 13
```

`-Only` takes a comma list (`-Only 13,15`) or an array, and a single quoted list
(`-Only '13,15'`) is split too. Steps always run in checklist order, and the
screenshots keep their names, so a partial run's `evidence\` compares with a full
one's.

A handful of steps read what an earlier step left behind and cannot rebuild it:
step 4 needs step 3's second launch in the log, step 12 needs the Title step 11
opened, step 18 needs the search surface step 17 left showing, and step 21 needs
the log steps 19 and 20 wrote. Run alone, one of these **refuses loudly** — it
prints the step it needs and the selection to run instead, and exits non-zero
without touching the machine — rather than checking the wrong state. `-List`
prints the same `needs:` line for every step.

When the fixture Addon is what a step needs, it is the same parameter the full
route uses: pass `-Addon`, `-AddonName`, `-AddonId` and `-AddonCatalog` as in
"The route, in full" (the `fixture-addon.ps1` server, with `-Addon
'http://127.0.0.1:8099/manifest.json' -AddonName Verify -AddonId
dev.streamingapp.verify -AddonCatalog Verify`).

## The route, in full

From WSL, in the repo root:

```sh
# 1. the frontend must be built; the container is where that happens
docker compose exec dev pnpm build

# 2. copy the tree to Windows (git archive = committed files only, plus the
#    working-tree scripts and the frontend, which is not in git)
scripts/windows/stage.sh /mnt/c/Users/<you>/streamingapp-verify

# 3. a video for the Addon fixture, so that playback has something to play that
#    is not a third party's content — and so that the control set has something
#    to move: two audio tracks, two embedded subtitle tracks, two chapters, and
#    black bars for mpv's stock autocrop (ffmpeg runs in the container)
scripts/windows/fixture-video.sh /mnt/c/Users/<you>/streamingapp-verify

# 4. build it there, and (in a second window) serve the fixture Addon
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\build.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify'
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\fixture-addon.ps1' \
  -Video 'C:\Users\<you>\streamingapp-verify\fixture\verify-controls.mkv'

# 5. walk the checklist in the first window
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\verify.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify' \
  -Addon 'http://127.0.0.1:8099/manifest.json' -AddonName Verify \
  -AddonId dev.streamingapp.verify -AddonCatalog Verify
```

`fixture-addon.ps1` is worth the second window whenever a run has to *play*
something: it serves a manifest, a movie catalog of two films and a series
catalog, their metadata, and a stream answer for each Video whose candidate is
the fixture video — one film that plays and one whose candidate is an `infoHash`,
so the "listed but not playable" half is walked too. The series carries two
episodes under the same `bingeGroup`, so `Next episode` has somewhere to go; the
viewer walks the control set over an episode rather than the film for exactly
that reason (a film offers no `Next episode`). Without the fixture the run is
pointed at a third-party Addon: `Cinemeta` answers no Streams at all, and a
torrent Addon without debrid configuration answers only candidates this version
cannot fetch.

Screenshots, the assertion report and the log tail land in
`<Tree>\evidence\` — read them from WSL as `/mnt/c/Users/<you>/streamingapp-verify/evidence/`.

## libmpv, on the Windows side

`host-mpv` links libmpv the way each platform links libraries. On Linux that is
the system `libmpv.so` the container already has; on Windows it is an `mpv.lib`
import library beside `libmpv-2.dll`, because MSVC's `link.exe` reads MSVC import
libraries and the shinchiro dev bundle ships a MinGW `libmpv.dll.a` and nothing
else. `build.ps1` therefore does this once per tree, and leaves it alone from
then on:

1. fetch the nightly libmpv dev bundle (the `-LibmpvUrl` parameter; shinchiro's
   `build_libmpv` workflow through nightly.link),
2. generate `mpv.lib` from the DLL's own exports — `dumpbin /exports` →
   `.def` → `lib /def:` (both found through `vswhere`, because neither is on
   `PATH`),
3. put the import library on the linker's path through the `LIB` environment
   variable the linker inherits, and copy `libmpv-2.dll` next to the built
   executable, which is where Windows looks for it.

To check the DLL is really there: `target\release\libmpv-2.dll`, and a Host
whose log says `the Player is ready` with `picture: InWindow` (it says
`the Host has no Player: nothing will play` when libmpv could not be linked in
or started).

## Things that cost time, so they don't again

- **A step that could not be walked used to read as a pass.** When the fixture
  Addon drew no series row, step 13 skipped its whole body and the run still
  printed `ALL CHECKS PASSED` — which is how a dead Addon (see below) looked like
  a green run. A step that cannot walk a check now calls `Skip`, and a run with
  any skip exits 2 instead of claiming the checklist was walked.
- **The fixture Addon dies on a seek.** `HttpListener` raises out of `Write` when
  the client abandons a range — which mpv does whenever it seeks, and whenever it
  has read enough — and an uncaught one ends the whole server mid-walkthrough.
  `fixture-addon.ps1` catches it per request now and answers the next one. Its
  log lives beside the evidence (`evidence\fixture-addon.log`), so "the Addon
  went down" is a thing you can read rather than guess.
- **A `Start-Process`-launched Addon outlives the shell that made it, but the WSL
  interop call that launches it does not return** until every process holding the
  console handles exits. Launch the fixture Addon and walk away from that
  command; run `verify.ps1` in a second one.
- **An Addon left running from an earlier session holds port 8099, and the port
  cannot be freed by its PID.** `HttpListener` registers with HTTP.sys, so
  `Get-NetTCPConnection -LocalPort 8099` names the owning process as **PID 4**
  (*System*) — which cannot be killed, and `Stop-Process` on it does nothing.
  Find the script's own PowerShell by its command line instead:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" |
    Where-Object { $_.CommandLine -like '*fixture-addon*' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
  ```
  Otherwise the next `fixture-addon.ps1` throws *"there is already a registration
  for the machine"* and every step that needs a Stream skips.
- **Windows binaries are not on `PATH`, and interop is not enabled for bare
  names.** Call them by full path:
  `/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe`. Have the
  shell's working directory somewhere under `/mnt/c` first — `cmd.exe` and
  PowerShell cannot start in `\\wsl.localhost\…` and warn about it.
- **Build on the Windows side, not over the WSL filesystem.** Rust, the linker
  and WebView2 all want a real Windows path; `git archive | tar -x` into
  `/mnt/c/...` is the cheap way there. `stage.sh` does it.
- **Build with `--features custom-protocol`, or the window comes up empty with a
  connection refused.** Tauri decides between its dev server and the frontend
  embedded in the binary with `dev = !custom-protocol`. `tauri build` passes
  `tauri/custom-protocol` itself; a plain `cargo build` — debug *or* release —
  does not, and the window then loads `devUrl` (localhost:1420) and shows
  `ERR_CONNECTION_REFUSED`. `build.ps1` passes it, and the app crate names the
  feature in `src-tauri/Cargo.toml` so a hand-rolled build can find it.
- **The frontend is not in git.** `dist/` is ignored, so it has to be copied
  across; `stage.sh` refuses to stage a tree without it.
- **PowerShell 5.1 turns native stderr into a terminating error** when
  `$ErrorActionPreference = 'Stop'`, and cargo writes its progress to stderr.
  `build.ps1` relaxes the preference around the cargo call and tees to
  `build.log`.
- **A Host left running from an earlier run breaks the next build**, and not in a
  way that says so: it holds its own executable open, and cargo fails with
  `failed to remove file ... Access is denied (os error 5)`, which reads like a
  permissions problem. It also holds the single-instance lock, so the next Host
  would merely focus it. `build.ps1` stops a leftover Host before building and
  `verify.ps1` stops one before it starts.
- **The wire server wants port 8090**, and the window shows the address it
  actually got — `host:8090` when it is free, whatever the operating system
  offered when it is not. A leftover Host is what usually holds it, and stopping
  that Host gives the port back. Nothing but the window decides the number a
  person types, which is why the window reads it out rather than the README.
- **The picture is a *child window* of the Host's, not a texture.** mpv is given
  the window's `HWND` as its `wid` and creates a child of it, which the app shell
  pushes to the bottom of the z-order and keeps the size of the window. When a
  step says the interface is above the picture, what it checks is the class list
  `verify.ps1` reads off the Host's window — topmost first — where
  `Chrome_WidgetWin…` must come before `mpv`. If the picture ever swallows a
  click, the click-over-the-video step fails and the reason is that the child
  window is not where it should be.
- **The window is transparent on Windows only**, which is why
  `src-tauri/tauri.windows.conf.json` restates the window config with
  `"transparent": true`: Tauri merges platform configs with JSON Merge Patch, so
  an array is *replaced* rather than merged and the whole window entry has to be
  there. Without it the page's opaque background would cover the picture.
- **A transparent window and a picture behind it is why the page stops painting.**
  The body gets `picture-behind` while a Stream is playing in the same window;
  anything the page paints over the video would hide it.
- **The window's data outlives the run.** The Host keeps its database and logs in
  `%APPDATA%\dev.streamingapp.host\` (`/mnt/c/Users/<you>/AppData/Roaming/dev.streamingapp.host`).
  `verify.ps1` starts by removing them, so "the preference survives a restart" is
  really being tested.
- **On Windows the config and data directories are the same directory**
  (`%APPDATA%\dev.streamingapp.host`); on Linux they differ (`~/.config` vs
  `~/.local/share`). Anything that assumes two distinct paths will look fine here
  and wrong there.
- **The TMDB key lives in the OS keyring, which the data-directory wipe at the
  top does not touch.** Step 19 enters its own test key, clears it again, and
  clears whatever a crashed earlier run left behind before it starts, so a run
  is honest about "no key is held" either way. Running the walkthrough does
  remove a real key you had configured: it is a verification Host, not the daily
  one.
- **The black bars are gone before the crop step, and that is mpv, not the Host.**
  `host-mpv` vendors mpv's own `TOOLS/lua/autocrop.lua`, which fires about five
  seconds after the file loads and sets `video-crop` itself. The fixture is
  letterboxed (1280x540 of picture in a 1280x720 frame) so there is something to
  find, and the crop step's first screenshot shows the bars already cut away —
  that is the script. What the step asserts is that *no* crop choice of the menu
  is the one in force until the Host is asked for one, and then that asking for
  one takes effect.
- **UI Automation needs a moment.** Chromium builds its accessibility tree only
  once a client asks for it, so `Find-Named`/`Page-Text` retry for a few seconds
  before giving up.
- **Close the Host, don't kill it, when you want its log tail.** The log writer is
  asynchronous and flushes on exit; `Stop-Process -Force` skips that. `verify.ps1`
  sends a window close and only falls back to killing — except in step 23, where
  killing the Host **is** the check: Watch progress has to have been written
  *while* playback ran (#29), so an unclean exit is the case being tested, and a
  clean close would hide a Host that only wrote on the way out.
- **The keyboard steps send real keys to the focused window**, so the run needs the
  Host in the foreground: `verify.ps1` calls `SetForegroundWindow` first and says so
  when it does not take. `{DOWN}` past the search box and onto a poster, `{ENTER}` to
  choose it — the same as a TV remote would.

## Windows will not have

`pnpm` (build the frontend in the container and copy `dist/`), `sqlite3` (read the
database from WSL if you need to), or a HDR display — HDR passthrough is a
different checklist, ticket #18.
