# CI and landing a ticket

Ticket work lands through a pull request. `.github/workflows/ci.yml` runs the
same suites `AGENTS.md` asks for, inside the same `docker/dev.Dockerfile` image
the development container uses:

1. `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm build`, `pnpm test`
2. `cargo fmt --check`
3. `cargo clippy --all-targets -- -D warnings`
4. `cargo test --workspace --no-fail-fast`

The job is `verify`, and `main` is protected: the `verify` check must pass,
administrators are included, and force pushes and deletions are refused.

## Docs-only pull requests

`verify` runs on every pull request because it is the required check. When every
changed path ends in `.md` or lives under `docs/`, the job skips the image build
and the suites and finishes in seconds; the required check is still green. Any
other change — including this workflow — runs the full list, and pushes to
`main` always run it.

## The landing sequence

1. Work in a worktree on a branch, never in the main checkout.
2. Push the branch and open a pull request against `main`.
3. Let `verify` finish. Fix failures on the branch; a new push reruns it.
4. Put the review trail on the pull request as a comment — what the reviews
   found, what changed, and what was deliberately kept.
5. Merge `origin/main` into the branch if it moved, and push.
6. Add the `automerge` label. The `Auto-merge` workflow enables GitHub's
   auto-merge with a merge commit; GitHub lands the PR once `verify` is green.
   Removing the label cancels auto-merge.
7. Fetch, and confirm the merged tree is the one verified:
   `git diff origin/main <branch>` must be empty.

Auto-merge is opt-in rather than automatic for every green PR: the label is the
moment a person or agent says the review trail is complete. The required check
is the part that cannot be skipped.

## What this is not

There is no deploy stage. The Host is a desktop application, not a service; a
release build and its signing/packaging are separate work, and the Windows
walkthrough still belongs to `scripts/windows/`.
