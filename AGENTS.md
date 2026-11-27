# AGENTS.md

## Task completion requirements

- **Build and test inside the container.** Never install toolchains or media
  libraries on the host; the host has no `cargo`, no `mpv` and needs `sudo`.
- `docker compose up -d` — start the long-lived dev container.
- `docker compose exec dev cargo test` — unit tests. TDD is the norm here: pure
  decision seams (parsers, id mapping, snapshot building, command validation) are
  tested from the start, with I/O behind seams and in-memory fakes. The window
  follows the same rule: its tests assert decisions, never markup (ADR-0032,
  `docs/agents/testing.md`).
- `docker compose exec dev cargo clippy --all-targets -- -D warnings`
- `docker compose exec dev cargo fmt --check`
- `docker compose exec -w /app/crates/host-torrent/engine dev go vet ./...` and
  `go test ./...` for the Torrent engine, a Go module of its own (ADR-0042 §1).
- `docker compose exec dev crates/host-torrent/build.sh` — builds the Torrent
  engine twice, `CGO_ENABLED=0`: `streamingapp-torrent.exe` for Windows into
  `crates/host-torrent/out/`, and a native binary into `target/torrent/`, where a
  debug `cargo run` in the container finds it. It first regenerates
  `engine/THIRD-PARTY.md` (`licenses.sh`) and `stage.sh`/`cd.sh` call it for you.
- `docker compose exec dev pnpm typecheck` and `pnpm test` for the window.
  `pnpm` runs at the repo root, where the frontend package lives.
- `docker compose exec dev pnpm build` before any release or bundle build: a debug
  build embeds whatever `dist/` holds (or nothing), a bundled one needs the real
  client on disk. `cargo test` needs no built frontend.
- `docker compose exec dev cargo run --bin live_check` — read-only conformance
  against real addons; it reports, it does not assert on third-party content.
- Do not leave warnings or errors introduced by the task unresolved.
- A container has no GPU here (no `/dev/dri`), so it cannot verify HDR passthrough
  or hardware decode. Those are verified on the Windows-native build.
- Every change lands through a pull request, by the sequence below.

## Landing a pull request (CI runs on this machine)

GitHub's runners are not used: the repository is private on the free plan, its
hosted runners fail at startup, and branch protection is unavailable. `verify`
runs here, through `scripts/ci.sh`, and **nothing on GitHub enforces it** — so
never push to `main` and never merge by hand (`gh pr merge`, the web button).

1. Work in a worktree on a branch, never in the main checkout.
2. Push the branch and open a pull request against `main`.
3. Put the review trail on the PR as a comment: what the reviews found, what
   changed, what was deliberately kept.
4. Bring the branch current: `git fetch origin && git merge origin/main`, then
   push. The script refuses a branch that is behind its base.
5. Add the label: `gh pr edit <pr> --add-label automerge`.
6. Run the CI, which verifies, posts the `verify` status, merges, and — for a
   code-changing PR — runs `scripts/cd.sh` to build the Windows NSIS installer
   and publish it to GitHub Releases:

```sh
scripts/ci.sh <pr>             # verify, post `verify`, merge + release if labelled
scripts/ci.sh <pr> --no-merge  # verify and post only
scripts/cd.sh                  # build and publish origin/main directly
```

7. Fetch and confirm the merged tree is the verified one:
   `git diff origin/main <branch>` must be empty.

What the script does: checks the PR's head out into a throwaway worktree (your
uncommitted files never reach the result), runs the same suites as
`.github/workflows/ci.yml` in the dev image through `.github/scripts/dev-run.sh`,
merges with a merge commit pinned to the head it verified, and invokes
`scripts/cd.sh` to stage the merged commit to a temporary Windows directory,
build the NSIS installer (`streamingapp_<version>_x64-setup.exe` with
`libmpv-2.dll` bundled), and publish the GitHub Release (`v0.1.<N>`). A
docs-only PR (every path `*.md` or under `docs/`) skips the suites and the
release build. The image layers, the cargo/`node_modules`/pnpm-store volumes,
and the Windows `%LOCALAPPDATA%\streamingapp-cd-cache` directory are kept
between runs, so only the first run downloads everything. A failure posts
`verify` red: fix it on the branch, push, and run it again. Details:
`docs/agents/ci.md`.

## Verifying the window (Windows, from WSL)

Anything windowed is verified on the Windows side, reached from WSL through
interop. Windows has Rust 1.99.1 MSVC (`%USERPROFILE%\.cargo\bin`), Node 24, mpv
0.41 and the WebView2 runtime; it has **no `pnpm`**, so the frontend is built in
the container and copied across, and **Windows binaries are not on `PATH`** —
call `powershell.exe` by full path from a working directory under `/mnt/c`.

```sh
docker compose exec dev pnpm build
scripts/windows/stage.sh /mnt/c/Users/<you>/streamingapp-verify

powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\build.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify'
powershell.exe -NoProfile -ExecutionPolicy Bypass \
  -File 'C:\Users\<you>\streamingapp-verify\scripts\windows\verify.ps1' \
  -Tree 'C:\Users\<you>\streamingapp-verify' -Monitor 1
```

**Open the window on the leftmost monitor** — `-Monitor 1`, and monitors are
numbered left to right. The machine is in use while a walkthrough runs: on any
other monitor the keyboard steps take the foreground away from whoever is typing,
and the screenshots capture whatever is in front rather than the Host. `verify.ps1`
fills the chosen monitor's working area for the run.

`verify.ps1` walks a windowed checklist, asserting through UI Automation and
screenshotting each step into `<Tree>\evidence\` (read it from WSL as `/mnt/c/…`);
the Host's own files land in `%APPDATA%\dev.streamingapp.host\`. It is a by-hand
walkthrough, **not** a test suite: run it deliberately, never in CI. The full
route, and the mistakes that cost time, are in `scripts/windows/README.md`.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

### Testing

What a window test may assert, what happens to a suite while the repertory redo
lands, and the gate a screen must clear before its old surface is deleted. See
`docs/agents/testing.md`.

## Project snapshot

The **Host** is a Tauri 2 desktop app that consumes the Stremio addon ecosystem,
resolves playable Streams, and plays them with mpv. Rust owns state, addon
transport and playback; React/TypeScript owns the interface. libmpv is linked
in-process and embedded with `wid`, so **mpv owns the video swapchain** — that is
what keeps HDR passthrough possible, and it is why the app is GPL-3.0.

Read before writing code: `CONTEXT.md` (the glossary — use its vocabulary
exactly), `docs/adr/` (decisions and their reasons), `docs/research/` (the
evidence behind them), and `docs/design-system.md` (the client's visual
reference: palette, type, focus, motion, component anatomy; ADR-0043 and
ADR-0031). Where an ADR contradicts what you are about to do, say so
explicitly instead of silently overriding it.

## Where the work lives

GitHub issue **#20** is the spec for the first vertical slice; its children
(**#21**–**#33**) are the implementation tickets, wired with native blocked-by
dependencies. Query the frontier before starting: open children with no open
blocker and no assignee, first in spec order wins. Do not start blocked work.
Issue **#1** is the earlier map, and the design record it produced still stands.

## Architecture

- `Cargo.toml` — a Rust workspace. `crates/` is the Host and holds no UI toolkit,
  so most tests never compile one; `src-tauri/` is the thin app shell that puts a
  window in front of it.
- `crates/host-core/` — the Host's state, its one Action surface, the Snapshots it
  publishes, and the `Store` seam. The Tauri IPC bridge and the network bridge are
  both translators over this, and no client gets a private path (ADR-0002,
  ADR-0008).
- `crates/host-addon/` — the addon transport: the real `Fetcher`, one blocking
  HTTP client. It is outside `host-core` because the Host's vocabulary and its
  decisions know nothing about the network (ADR-0009).
- `crates/host-mpv/` — the real `Player`: mpv linked in-process, with the
  picture put wherever the platform can put it. Outside `host-core` for the same
  reason as the transport above (ADR-0013), and the only crate that names a
  thing mpv calls something.
- `crates/host-sqlite/` — the real `Store`. The only place SQL and the schema live.
- `crates/host-wire/` — the remote clients' transport: a duplex WebSocket on the
  Host's LAN address carrying the one Action surface, the page a browser pairs
  with, and the mDNS announcement that finds it. Outside `host-core` for the same
  reason as the transport and the player above; the protocol's own codec is in
  `host-core`, because it is the Host's vocabulary written down (ADR-0017).
- `crates/host-torrent/` — the real `TorrentEngine`: the bundled Go program of
  `engine/` (over `anacrolix/torrent`, GPL-3.0-or-later with MPL-2.0 modules)
  started as a child on the first torrent played, JSON lines over stdio on OS
  threads, no `tokio` and no `unsafe`. Outside `host-core` for the same reason as
  the transport and the player above (ADR-0042 §1). Its tests spawn a scripted
  stand-in (`fake-torrent-engine`), never the Go engine; `build.sh` builds the Go
  one and `licenses.sh` writes the licences that ship with it.
- `crates/host-logging/` — structured logs: JSON lines in the data directory.
- `crates/host-live/` — the read-only conformance run against real Addons
  (`live_check`): the Host's addon path composed over the transport and the
  parsers, reporting what each resource answered. Outside `host-core` for the
  same reason as the transport above — it reaches the network (ADR-0009,
  ADR-0019).
- `src-tauri/` — the app shell: platform directories, logging, the store, the
  window, single-instance behaviour, and the IPC commands. It holds no rules.
- `src/` — the React/TypeScript window. It is a client of the Host, not a
  co-owner of state: it takes Actions and renders the Snapshots it is sent.
- `docker/`, `compose.yaml`, `compose.wslg.yaml` — the development toolchain;
  `compose.wslg.yaml` adds GUI passthrough and software rendering on WSLg.
- `scripts/windows/` — the route to the Windows build, where the window is
  verified by hand (see "Verifying the window" above).
- `docs/agents/` — how the skills read this repo's domain documentation.
- `docs/research/` — fact-finding notes with citations, including the negatives.
- `docs/adr/` — one decision per file, with the alternatives that were rejected.
