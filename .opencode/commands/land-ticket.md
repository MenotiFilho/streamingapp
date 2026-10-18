---
description: Sync a ticket branch with main, resolve conflicts, run the suites, and land the PR through CI
---

Land the ticket branch `$ARGUMENTS` — a PR number or a branch name. If it is
neither, stop and ask: do not guess the target. Work in the ticket's worktree,
never the main checkout, and run every build and test in the dev container:
`docker compose up -d` first, and always run `docker compose exec` from the repo
root — from inside a worktree it picks that worktree's own compose project and
finds no container.

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

   These are the same commands, in the same image, that the `verify` job runs, so
   a green local run is the fastest way to a green PR.

3. **Fix any failures.** If a flaky test surfaces under load, reproduce it with
   every core busy before fixing it — wait for the fact a test asserts rather
   than for the moment before it. Re-run until green.

4. **Push the updated branch** (`source ~/.keychain/*-sh` first; verify with
   `ssh-add -l`). If the branch has no PR yet, open one —
   `gh pr create --base main --head <branch>`. Then resolve the pull request
   number once — `n=$(gh pr view <branch> --json number --jq .number)` — and use
   it below. Wait for `verify` on the pushed head with `gh pr checks "$n"
   --watch`: `main` is protected, so the check must be green. Fix failures on
   the branch; a new push reruns the check. Do not merge by hand — the
   repository lands through the `automerge` label.

5. **Comment the review trail on the PR** — what the reviews found, what
   changed, what was deliberately kept. Then confirm the branch is current:
   `git fetch origin`; if `origin/main` moved, merge it, push, and let `verify`
   run again. The required check is strict, so a branch behind `main` cannot
   land — auto-merge waits for the sync instead of merging the old base, and the
   sync's push is what reruns `verify`. Add the `automerge` label
   (`gh pr edit "$n" --add-label automerge`) only after both: the `Auto-merge`
   workflow enables GitHub's auto-merge (a merge commit, leaving the branch),
   and GitHub lands the PR once `verify` is green. Removing the label cancels
   auto-merge.

6. **Confirm `main` afterwards**: `git fetch origin`, check the PR merged with
   a merge commit, and that `git diff origin/main <branch>` is empty — the
   merged tree is the one you verified. Report that it landed.
