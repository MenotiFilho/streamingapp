---
description: Sync a ticket branch with main, resolve conflicts, run the suites, and merge the PR
---

Land the ticket branch `$ARGUMENTS` — a PR number or a branch name. Work in the
ticket's worktree, never the main checkout, and run every build and test in the
dev container: `docker compose up -d` first, and always run `docker compose exec`
from the repo root — from inside a worktree it picks that worktree's own compose
project and finds no container.

1. **Sync with the latest `main`.** `git fetch origin`, then merge `origin/main`
   into the ticket branch. Resolve any syntactic or logical/semantic conflicts —
   broken imports, altered function signatures, duplicate migrations, dependency
   issues, capability lists and Snapshot fixtures that auto-merged. A clean
   auto-merge is not proof the merge is sound: read the joined regions by hand.

2. **Run the project's build and test suites** (target the worktree with
   `docker compose exec dev bash -c "cd /app/.worktrees/<n> && …"`):

   - Build/typecheck: `pnpm typecheck && pnpm build`
   - Tests: `cargo test --workspace --no-fail-fast && pnpm test`
   - Gates: `cargo clippy --all-targets -- -D warnings` and `cargo fmt --check`

3. **Fix any failures.** If a flaky test surfaces under load, reproduce it with
   every core busy before fixing it — wait for the fact a test asserts rather
   than for the moment before it. Re-run until green.

4. **Push the updated branch** (`source ~/.keychain/*-sh` first; verify with
   `ssh-add -l`). If the branch has no PR yet, open one —
   `gh pr create --base main --head <branch>` — then confirm it reports
   `MERGEABLE`/`CLEAN`.

5. **Comment the review trail on the PR** — what the reviews found, what changed,
   what was deliberately kept — then merge with `gh pr merge <n> --merge` (the
   repo's style: a merge commit, leaving the branch).

6. **Confirm `main` afterwards**: fetch and check the merged tree is the one you
   verified (`git diff origin/main <branch>` is empty), then report that it
   landed.
