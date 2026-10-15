# AGENTS.md

## Task completion requirements

- **Build and test inside the container.** Never install toolchains or media
  libraries on the host; the host has no `cargo`, no `mpv` and needs `sudo`.
- `docker compose up -d` — start the long-lived dev container.
- `docker compose exec dev cargo test` — unit tests. TDD is the norm here: pure
  decision seams (parsers, id mapping, snapshot building, command validation) are
  tested from the start, with I/O behind seams and in-memory fakes.
- `docker compose exec dev cargo clippy --all-targets -- -D warnings`
- `docker compose exec dev cargo fmt --check`
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

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in this repo, managed with the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical triage roles, using the default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## Project snapshot

The **Host** is a Tauri 2 desktop app that consumes the Stremio addon ecosystem,
resolves playable Streams, and plays them with mpv. Rust owns state, addon
transport and playback; React/TypeScript owns the interface. libmpv is linked
in-process and embedded with `wid`, so **mpv owns the video swapchain** — that is
what keeps HDR passthrough possible, and it is why the app is GPL-3.0.

Read before writing code: `CONTEXT.md` (the glossary — use its vocabulary
exactly), `docs/adr/` (decisions and their reasons), and `docs/research/` (the
evidence behind them). Where an ADR contradicts what you are about to do, say so
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
- `crates/host-sqlite/` — the real `Store`. The only place SQL and the schema live.
- `crates/host-logging/` — structured logs: JSON lines in the data directory.
- `src-tauri/` — the app shell: platform directories, logging, the store, the
  window, single-instance behaviour, and the IPC commands. It holds no rules.
- `src/` — the React/TypeScript window. It is a client of the Host, not a
  co-owner of state: it takes Actions and renders the Snapshots it is sent.
- `docker/`, `compose.yaml`, `compose.wslg.yaml` — the development toolchain;
  `compose.wslg.yaml` adds GUI passthrough and software rendering on WSLg.
- `docs/agents/` — how the skills read this repo's domain documentation.
- `docs/research/` — fact-finding notes with citations, including the negatives.
- `docs/adr/` — one decision per file, with the alternatives that were rejected.
