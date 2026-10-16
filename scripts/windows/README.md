# The Host's window, on the Windows side

The dev container has no display and no GPU, so **the window is verified on
Windows**, reached from WSL. This directory is that route, written down so it is
run the same way twice:

- `stage.sh` — run in WSL: copies the tree to a Windows path, with the built frontend.
- `build.ps1` — run on Windows: fetches libmpv, makes it linkable, and does a
  release build of the app shell.
- `verify.ps1` — run on Windows: walks the window's manual checklist, asserting
  through UI Automation and screenshots each step into `evidence\`.

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
listed, says it is not playable yet, and nothing is drawn for it.

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

## The route, in full

From WSL, in the repo root:

```sh
# 1. the frontend must be built; the container is where that happens
docker compose exec dev pnpm build

# 2. copy the tree to Windows (git archive = committed files only, plus the
#    working-tree scripts and the frontend, which is not in git)
scripts/windows/stage.sh /mnt/c/Users/<you>/streamingapp-verify

# 3. a video for the Addon fixture, so that playback has something to play that
#    is not a third party's content (ffmpeg runs in the container)
scripts/windows/fixture-video.sh /mnt/c/Users/<you>/streamingapp-verify

# 4. build it there, and (in a second window) serve the fixture Addon
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\build.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify'
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\fixture-addon.ps1' \
  -Video 'C:\Users\<you>\streamingapp-verify\fixture\verify-720p.mp4'

# 5. walk the checklist in the first window
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\verify.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify' \
  -Addon 'http://127.0.0.1:8099/manifest.json' -AddonName Verify \
  -AddonId dev.streamingapp.verify -AddonCatalog Verify
```

`fixture-addon.ps1` is worth the second window whenever a run has to *play*
something: it serves a manifest, a catalog of two films, their metadata and a
stream answer whose candidate is the fixture video — one film that plays and one
whose candidate is an `infoHash`, so the "listed but not playable" half is walked
too. Without it the run is pointed at a third-party Addon: `Cinemeta` answers no
Streams at all, and a torrent Addon without debrid configuration answers only
candidates this version cannot fetch.

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
  top does not touch.** Step 18 enters its own test key, clears it again, and
  clears whatever a crashed earlier run left behind before it starts, so a run
  is honest about "no key is held" either way. Running the walkthrough does
  remove a real key you had configured: it is a verification Host, not the daily
  one.
- **UI Automation needs a moment.** Chromium builds its accessibility tree only
  once a client asks for it, so `Find-Named`/`Page-Text` retry for a few seconds
  before giving up.
- **Close the Host, don't kill it, when you want its log tail.** The log writer is
  asynchronous and flushes on exit; `Stop-Process -Force` skips that. `verify.ps1`
  sends a window close and only falls back to killing.
- **The keyboard steps send real keys to the focused window**, so the run needs the
  Host in the foreground: `verify.ps1` calls `SetForegroundWindow` first and says so
  when it does not take. `{DOWN}` past the search box and onto a poster, `{ENTER}` to
  choose it — the same as a TV remote would.

## Windows will not have

`pnpm` (build the frontend in the container and copy `dist/`), `sqlite3` (read the
database from WSL if you need to), or a HDR display — HDR passthrough is a
different checklist, ticket #18.
