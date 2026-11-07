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
   the head it verified (`--match-head-commit`). `--no-merge` verifies only.
   Fix a failure on the branch, push, and run it again.
7. Fetch, and confirm the merged tree is the one verified:
   `git diff origin/main <branch>` must be empty.

## What this is not

There is no deploy stage. The Host is a desktop application, not a service; a
release build and its signing/packaging are separate work, and the Windows
walkthrough still belongs to `scripts/windows/`.
