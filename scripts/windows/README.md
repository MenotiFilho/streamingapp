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

The checklist is the **ten-foot shell** (#87), now the window's only client. It
covers the whole surface: the six-destination rail (**Home · Discover · Search ·
Library · Addons · Settings**) with its D-pad geometry; Home's Featured hero, its
rotation and its text fallback, Continue watching and one row per Catalog; the
Title and the Streams level above it; the player OSD, with one popover per icon,
auto-hide, the episode steps and the volume pillar; the window's fullscreen
control on the base, a pushed Title, Settings and a confirm dialog, F11 from
each and with the OSD hidden, the strip's Up-from-the-top-row landing and a
click through the strip onto the rail beneath it, and the OSD's own copy of the
button; Settings' Preferences, Credentials, Remote devices and About/Credits
sub-screens; the subtitle appearance (colour and size, their restart, and what
they do to an SRT and an ASS track); the key-gated Discover and Search; the
Library sign-in gate; and the
TMDB attribution.

The Addon it configures is a parameter, so the walkthrough can be run against the
Addon the owner actually uses — including one whose manifest URL carries a debrid
configuration, which is the case the "the URL never leaves the Host" checks are
for:

```sh
... -Addon 'https://api.stremboxd.com/manifest.json' -AddonName Stremboxd `
    -AddonId community.stremboxd -AddonCatalog 'Popular This Week'
```

The fixture Addon (`fixture-addon.ps1`) is what makes playback walkable: it
serves a movie Catalog, a series Catalog, their metadata, and Stream answers
whose candidates are a local video file. The file carries two audio tracks,
three embedded subtitle tracks — two plain-text (SRT) and one ASS line authored
red, so the colour can be checked on both kinds — two chapters and letterbox
bars, so every OSD control has something to move; the series has two episodes,
so `Next episode` and `Previous episode` have somewhere to go. One film's candidate is an `infoHash`,
which this Host lists and marks unplayable rather than pretending to play.

The remote steps (25 and 26) pair and drive the **Cast Remote** (#32, ADR-0035):
since the cutover (#216) `/` serves the React Remote, drawn in the Cast Remote's
three surfaces — the six-destination browse surface (Home · Discover · Search ·
Library · Addons · Settings), the expanded card the docked player strip opens,
and its plates, Audio & Subtitles included. Its choices reach the Host
immediately. `verify.ps1` walks the window's shared-state half
(the paired device, and a Stream the remote starts showing up in the Host's own
OSD); the remote's own surfaces are the operator's evidence as they walk the
printed route, because the script cannot screenshot another device.

The steps that depend on what a third-party Addon serves are structural — the
rows stopped loading, the search arm is showing, the Title names the Addon that
answered, a window class is or is not among the Host's children — and the
screenshot is the evidence a person reads. The one thing these steps *cannot*
walk is a Stream that fails to open: that needs an Addon whose URLs are dead, so
it is checked by the tests instead (`crates/host-mpv/tests/mpv.rs` drives a real
headless mpv at a URL that 404s, and `src/shell/Shell.test.tsx` renders the
failure alert beside Home with no player). By hand, point `-Addon` at a dead
Stream to see it.

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

## What the steps stand on

The new shell has no revision line to read: its Snapshots are followed silently.
Where a check has to say "this question moved nothing", `verify.ps1` counts the
Host's own `publishing a Snapshot` log lines instead — the same record every
client is told of, and one that cannot be scrolled off the window. A step that
publishes takes a baseline, waits for the next line, and a step that must not
publish compares the count either side of the question.

The rail is the only control that changes the base screen, and a pushed level
makes everything under it inert. The helpers that move around therefore pop any
open levels with Back (Escape) before pressing a destination. The OSD puts itself
away after three idle seconds: a step that needs an icon awake moves the pointer
before looking for it, and the auto-hide step is the one that deliberately waits
the three seconds out.

## Walking part of the checklist

The whole checklist is 37 steps and takes minutes. To iterate on one step, run
just that one: the runner builds the ground the step declares first — an empty
data directory, one Host on `-Monitor`, the fixture Addon configured by manifest
URL, its first Catalog featured, at Home — and reuses it when several selected
steps need it, so you never sit through the earlier steps to see whether step 13
works now:

```sh
# 1. the whole checklist, in order (what "The route, in full" below does)
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -Tree 'C:\...' -Monitor 1

# 2. what the steps are, and what each one needs, without starting a Host — the
#    discovery path, and the cheap syntax check
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -List

# 3. just the OSD (step 13). It sets up first: one Host from an empty data
#    directory, the fixture Addon configured and featured, at Home.
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -Tree 'C:\...' -Monitor 1 -Only 13

# 4. from step 13 on: the OSD, the Title, the series, paging, Search, the TMDB
#    key, removing the Addon, the log and the data directory
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\...\scripts\windows\verify.ps1' -Tree 'C:\...' -Monitor 1 -From 13
```

`-Only` takes a comma list (`-Only 13,15`) or an array, and a single quoted list
(`-Only '13,15'`) is split too. Steps always run in checklist order, and the
screenshots keep their names, so a partial run's `evidence\` compares with a full
one's.

A handful of steps read what an earlier step left behind and cannot rebuild it:
step 4 needs steps 2 and 3 (the saved language, and the second launch in the
log), step 12 needs the Title step 11 opened, step 18 needs the Search screen step
17 left showing, and step 21 needs the log steps 19 and 20 wrote. Run alone, one
of these **refuses loudly** — it prints the step it needs and the selection to run
instead, and exits non-zero without touching the machine — rather than checking
the wrong state. `-List` prints the same `needs:` line for every step.

When the fixture Addon is what a step needs, it is the same parameter the full
route uses: pass `-Addon`, `-AddonName`, `-AddonId` and `-AddonCatalog` as in
"The route, in full" (the `fixture-addon.ps1` server, with `-Addon
'http://127.0.0.1:8099/manifest.json' -AddonName Verify -AddonId
dev.streamingapp.verify -AddonCatalog Verify`).

A partial run that needs a Continue watching row (the short-row wall half of
step 27) has none to rebuild: it says so and skips that check, with exit code 2,
rather than reporting a pass it did not walk.

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
#    to move: two audio tracks, two SRT subtitle tracks and one ASS track with
#    its own colour, two chapters, and black bars for the Autocrop toggle
#    (ffmpeg runs in the container)
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

Two steps are deliberately by hand and block the run until a person acts: step
24 waits while you sign in to Stremio in the window (up to five minutes), and
steps 25 and 26 wait while you pair a browser on another device (up to five
minutes each). A run that means to walk them needs the account and the second
device; a run of the rest can use `-Only` with the steps it wants.

**The focus reveal (#127) has no scripted step yet.** It was built while the
owner deferred all windowed evidence to one batch after #126, #127 and #128, so
`-List` does not name it and a run does not walk it. When that batch runs, the
reveal is read from screenshots: the focused card at each edge of the window
(top, bottom, left, right, and the end of a horizontally scrolled row), a long
Settings list scrolled past the fixed chrome, and one OSD popover. On each, the
control's ring and lift must be fully visible and never under the 56px chrome
strip; at the top the first row sits at the layout's 64px clearance, and the
page's own bottom keeps 24px. Left and right keep 24px only where the port can
still scroll: a row's 16px padding caps whichever end it has reached, so the
margin there is 16px rather than 24px. The batch will also need the shots that
record those floors: the start and the end of a row, where the track's 16px
padding caps the margin, and the seasons strip, where `--space-1` (4px) caps
each end. The control will still be fully visible in all of them; the 24px
margin is what shrinks, so those shots record the floor rather than a failure.

**The focus wall (#245) is scripted in step 27, but its batch run is still
deferred.** The step asserts the changed move: Right at the end of a short
Continue watching row holds on the row's last control (its More card) instead of
leaving for a control in the rail below, and `27-dpad.png` records the stop. When
there is no Continue watching row, the step skips rather than asserting a wall.
The same step's log records both rail ends still stopping; that is check-log
evidence, not a
screenshot. Up from the top row still reaching the fullscreen strip belongs to
step 33, which takes its own `33-up-from-top-row.png`. Down from a branch's Back
entering an off-side child is not scripted; `focus.test.ts` covers it, and the
row-end wall and the rejected crossing are its too. The shell's own suite is
`repertory/frame.test.tsx`. Step 27 holds the row's last control; a destination
outside the row (a hero or the chrome) is outside its scope and skips.
The Remote uses the same ranking, but its arrows are the operator's own evidence
on the second device; `verify.ps1` screenshots the Host's window only.

Steps 19 and 30 enter a test TMDB key and clear it again. The key lives in the
OS keyring, which the data-directory wipe at the top does not touch, so both
steps clear whatever a crashed earlier run left behind before they start and
leave no key behind. Running the walkthrough does remove a real key you had
configured: it is a verification Host, not the daily one.

Screenshots, the assertion report and the log tail land in `<Tree>\evidence\` —
read them from WSL as `/mnt/c/Users/<you>/streamingapp-verify/evidence/`.

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
  top does not touch.** Steps 19 and 30 clear a key left behind before they
  start, enter their own test key, and clear it again, so a run is honest about
  "no key is held" either way. Running the walkthrough does remove a real key you
  had configured: it is a verification Host, not the daily one.
- **The black bars are there on load, and Autocrop is what removes them.**
  `host-mpv` vendors mpv's own `TOOLS/lua/autocrop.lua` but starts it with
  `script-opts=autocrop-auto=no`, so `file-loaded` does not crop (#119). The
  fixture is letterboxed (1280x540 of picture in a 1280x720 frame) so there is
  something to find: the crop step's first screenshot shows the bars, pressing
  **Autocrop** runs the script's own detect and cuts them away, and pressing
  **Restore full frame** puts them back. There is no timer to wait out any more.
- **UI Automation needs a moment.** Chromium builds its accessibility tree only
  once a client asks for it, so `Find-Element`/`Page-Text` retry for a few seconds
  before giving up.
- **Close the Host, don't kill it, when you want its log tail.** The log writer is
  asynchronous and flushes on exit; `Stop-Process -Force` skips that. `verify.ps1`
  sends a window close and only falls back to killing — except in step 23, where
  killing the Host **is** the check: Watch progress has to have been written
  *while* playback ran (#29), so an unclean exit is the case being tested, and a
  clean close would hide a Host that only wrote on the way out.
- **The keyboard steps send real keys to the focused window**, so the run needs the
  Host in the foreground: `verify.ps1` calls `SetForegroundWindow` first and says so
  when it does not take. `{DOWN}` past the hero and onto a card, `{ENTER}` to
  choose it, `{RIGHT}` out of the rail — the same as a TV remote would.
- **The subtitle colour is a fact about pixels, so a person reads it.** Steps 34
  and 35 assert everything the accessibility tree can carry — the chips and
  their pressed state, the percentage readout, the Snapshots a change publishes,
  the restart — and screenshot the picture for the rest: an SRT line takes the
  colour, an ASS line keeps the red it was authored with, and both are shot at
  100% and 125% so the size comparison has both images (`35-srt-yellow.png`,
  `35-srt-yellow-large.png`, `35-ass-authored-100.png`,
  `35-ass-authored-125.png`). The fixture's ASS track is authored red precisely
  so the two cases cannot be confused. The SRT cues sit in short windows so they
  do not leak into later steps' screenshots; the ASS line only shows while the
  ASS track is chosen. If step 35 skips, the configured Addon served a Stream
  without the fixture's tracks (or no playable candidate), and the reason is
  printed.
- **An Up next needs a finished episode.** Step 36 seeks the fixture video to
  its last seconds, stops, and presses the row's `Up next` card; the Title's
  main control must read `Play S1E2`, and Play must open S1E2 with no Streams
  list in between (#276). If no Up next card appears, the fixture Addon's meta
  answer listed no episode after the one that finished.
- **A second open is the cache's.** Step 37 opens a series Title, backs out and
  opens the same Title again, timing the press; under three seconds with the
  Title's seasons drawn is the cache answering (#266, ADR-0038 §1). The first
  open filled it, so a second open that is slow is the Host reading the Addon
  again.
- **The OSD is not always there.** It hides itself after three idle seconds and
  comes back on any key or pointer movement. A step that reads the transport or
  an icon after a wait moves the pointer first (the same motion a person makes),
  and the auto-hide check is the one that waits the three seconds out on purpose.
- **The rail is inert under a pushed level.** A destination cannot be pressed
  while a Title, a Streams list, a Settings sub-screen, or a confirmation is open,
  because everything under the top level is inert. `Open-Destination` presses Back
  a few times first; a by-hand run does the same with Escape.
- **The new shell has no revision line.** Where an older run read
  `Snapshot revision | 4` off the window, the walkthrough now counts the Host's
  `publishing a Snapshot` log lines. That is the same record every client is told
  of, and it does not go stale when the window scrolls.

## Windows will not have

`pnpm` (build the frontend in the container and copy `dist/`), `sqlite3` (read the
database from WSL if you need to), or a HDR display — HDR passthrough is a
different checklist, ticket #18.
