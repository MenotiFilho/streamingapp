# CI and landing a ticket

Ticket work lands through a pull request, and `verify` runs **on the owner's
machine**, not on GitHub's runners. `scripts/ci.sh` runs the same suites
`AGENTS.md` asks for, inside the same `docker/dev.Dockerfile` image the
development container uses:

1. `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`,
   `pnpm build:remote`, `pnpm test`
2. the committed Remote artifact is current, and stays out of `dist/`
3. `cargo fmt --check`
4. `cargo clippy --all-targets -- -D warnings`
5. `cargo test --workspace --no-fail-fast`
6. `go vet ./...` and `go test ./...` in `crates/host-torrent/engine` — the
   Torrent engine is a Go module of its own, with Go pinned in the image

It checks the pull request's head out into a throwaway worktree, so nothing
uncommitted in your checkout reaches the result, and posts the outcome as a
commit status named `verify` on the head commit.

It needs only `gh` to be logged in: the script fetches the base and the head
over HTTPS with `gh`'s credential, not through `origin`'s SSH URL, so it works
without an SSH key or agent. It writes the same `origin/*` refs a plain fetch
would and changes no git config.

## Why not GitHub's runners

The repository is private on the free plan: GitHub's hosted runners stopped
starting (`startup_failure`) and branch protection is not available, so the
required `verify` check no longer existed to enforce. `verify` is now this
machine's word. `.github/workflows/ci.yml` stays as the written-down suite and
runs only by hand (`workflow_dispatch`); the `Auto-merge` workflow is gone, its
job is the script's.

Because nothing on GitHub enforces it, **do not push to `main` or merge by
hand**: a change lands only through `scripts/ci.sh`.

## Docs-only pull requests

When every changed path ends in `.md` or lives under `docs/` (a rename counts as
a deletion plus an addition), the script skips the image and the suites and
posts `verify` green. Any other change runs the full list.

## The landing sequence

1. Work in a worktree on a branch, never in the main checkout.
2. Push the branch and open a pull request against `main`.
3. Put the review trail on the pull request as a comment — what the reviews
   found, what changed, and what was deliberately kept.
4. Merge `origin/main` into the branch if it moved, and push. The script refuses
   a branch that is behind its base.
5. Add the `automerge` label: it is the moment a person or agent says the review
   trail is complete.
6. Run `scripts/ci.sh <pr>` from any checkout. It verifies the head, posts
   `verify`, and — only with the label — merges with a merge commit, pinned to
   the head it verified (`--match-head-commit`), then runs `scripts/cd.sh` to
   build and publish the Windows installer release when the PR touched code.
   `--no-merge` verifies only. Fix a failure on the branch, push, and run it
   again.
7. Fetch, and confirm the merged tree is the one verified:
   `git diff origin/main <branch>` must be empty.

## CD: the Windows installer release (`scripts/cd.sh`)

Every code-changing pull request that merges through `scripts/ci.sh` continues
into `scripts/cd.sh` on this machine (docs-only merges skip it). `scripts/cd.sh`
can also be run directly when a release needs to be published or retried on its
own:

```sh
scripts/cd.sh                    # build and publish origin/main
scripts/cd.sh <ref>              # build and publish a specific commit/ref
scripts/cd.sh [ref] --dry-run    # build the installer and checksum without publishing
```

What `scripts/cd.sh` does:

1. Computes the release version `0.1.<N>` (and tag `v0.1.<N>`) from the base
   `<major>.<minor>` in `src-tauri/tauri.conf.json` and `git rev-list --count`
   on the target commit, so releases advance automatically without version-bump
   commits. If the tag is already published at that commit, it exits cleanly.
2. Checks the target commit out into a throwaway worktree (`cd-worktree`) and
   builds `dist/` inside the `streamingapp-dev:ci` container.
3. Stages the committed tree and built `dist/` into a clean temporary Windows
   directory under `%LOCALAPPDATA%\Temp\streamingapp-cd-…`, wiped on exit.
4. Calls `scripts/windows/build.ps1 -Bundle -Version <version> -CacheDir …` on
   Windows to build the unsigned per-user (`currentUser`) NSIS setup `.exe`
   (`streamingapp_<version>_x64-setup.exe`) with `libmpv-2.dll` and the Torrent
   engine (`streamingapp-torrent.exe`, cross-compiled by
   `crates/host-torrent/build.sh` in the container beforehand) bundled beside
   `streamingapp.exe`, and the engine's licences (`THIRD-PARTY.md`) with them. `libmpv`, `cargo-tauri` and Cargo's `target/` live in
   `%LOCALAPPDATA%\streamingapp-cd-cache` so builds stay incremental and never
   touch `streamingapp-verify` or stop a running Host window.
5. Writes a `.sha256` checksum file alongside the installer and publishes both
   to GitHub Releases as the latest release with `--generate-notes`.

## What this is not

The Windows walkthrough (`scripts/windows/verify.ps1`) is still a by-hand check,
never run in CI or CD, and installers are published unsigned for now.
