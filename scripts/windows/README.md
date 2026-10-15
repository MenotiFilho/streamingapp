# The Host's window, on the Windows side

The dev container has no display and no GPU, so **the window is verified on
Windows**, reached from WSL. This directory is that route, written down so it is
run the same way twice:

- `stage.sh` — run in WSL: copies the tree to a Windows path, with the built frontend.
- `build.ps1` — run on Windows: a release build of the app shell.
- `verify.ps1` — run on Windows: walks the window's manual checklist, asserting
  through UI Automation and screenshots each step into `evidence\`.

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

# 3. build and run the walkthrough there
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\build.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify'
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\verify.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify'
```

Screenshots, the assertion report and the log tail land in
`<Tree>\evidence\` — read them from WSL as `/mnt/c/Users/<you>/streamingapp-verify/evidence/`.

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
- **The window's data outlives the run.** The Host keeps its database and logs in
  `%APPDATA%\dev.streamingapp.host\` (`/mnt/c/Users/<you>/AppData/Roaming/dev.streamingapp.host`).
  `verify.ps1` starts by removing them, so "the preference survives a restart" is
  really being tested.
- **On Windows the config and data directories are the same directory**
  (`%APPDATA%\dev.streamingapp.host`); on Linux they differ (`~/.config` vs
  `~/.local/share`). Anything that assumes two distinct paths will look fine here
  and wrong there.
- **UI Automation needs a moment.** Chromium builds its accessibility tree only
  once a client asks for it, so `Find-Named`/`Page-Text` retry for a few seconds
  before giving up.
- **Close the Host, don't kill it, when you want its log tail.** The log writer is
  asynchronous and flushes on exit; `Stop-Process -Force` skips that. `verify.ps1`
  sends a window close and only falls back to killing.

## Windows will not have

`pnpm` (build the frontend in the container and copy `dist/`), `sqlite3` (read the
database from WSL if you need to), or a HDR display — HDR passthrough is a
different checklist, ticket #18.
