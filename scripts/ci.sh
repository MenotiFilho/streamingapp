#!/usr/bin/env bash
# Run `verify` on this machine for a pull request, record it on GitHub, and land
# the pull request when it carries the `automerge` label.
#
#   scripts/ci.sh <pr-number>        verify, report, merge if labelled
#   scripts/ci.sh <pr-number> --no-merge
#
# GitHub's runners are not used: the suites are the ones `.github/workflows/ci.yml`
# lists, run in the same development image through `.github/scripts/dev-run.sh`.
# The pull request's head is checked out into a throwaway worktree, so whatever
# is uncommitted in the checkout you run this from never reaches the result.
#
# The outcome is posted as a commit status named `verify` on the head commit —
# the same name the workflow's check had — so the pull request shows it. It is
# this machine's word; nothing on GitHub re-runs it (docs/agents/ci.md).
set -euo pipefail

pr="${1:?usage: scripts/ci.sh <pr-number> [--no-merge]}"
merge=true
if [[ "${2:-}" == "--no-merge" ]]; then
  merge=false
fi

root="$(git rev-parse --show-toplevel)"
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
image="streamingapp-dev:ci"

read -r head_ref head_sha base_ref state labels < <(
  gh pr view "$pr" --json headRefName,headRefOid,baseRefName,state,labels \
    --jq '[.headRefName, .headRefOid, .baseRefName, .state, ([.labels[].name] | join(",") | if . == "" then "-" else . end)] | @tsv'
)

if [[ "$state" != "OPEN" ]]; then
  echo "PR #$pr is $state; nothing to verify." >&2
  exit 1
fi

status() {
  gh api --method POST "repos/$repo/statuses/$head_sha" \
    -f state="$1" -f context=verify -f description="$2" --silent
}

git -C "$root" fetch --quiet --no-tags origin "$base_ref" "$head_ref"
if [[ "$(git -C "$root" rev-parse "origin/$head_ref")" != "$head_sha" ]]; then
  echo "origin/$head_ref is not the PR's head $head_sha; fetch again." >&2
  exit 1
fi

# A branch that is behind its base was verified against a tree that will not be
# the one landing; docs/agents/ci.md asks for it to be current first.
if ! git -C "$root" merge-base --is-ancestor "origin/$base_ref" "$head_sha"; then
  echo "PR #$pr is behind origin/$base_ref: merge it into the branch and push." >&2
  exit 1
fi

work="$(git -C "$root" rev-parse --git-common-dir)/ci-worktree"
work="$(cd "$(dirname "$work")" && pwd)/$(basename "$work")"
git -C "$root" worktree remove --force "$work" 2>/dev/null || rm -rf "$work"
git -C "$root" worktree prune
git -C "$root" worktree add --quiet --detach "$work" "$head_sha"

run() { GITHUB_WORKSPACE="$work" IMAGE="$image" "$root/.github/scripts/dev-run.sh" "$@"; }

cleanup() {
  # The container writes as root into the bind mount; hand those files back
  # before the worktree is removed. The named volumes are left as they are.
  if [[ -d "$work" ]]; then
    run sh -c "find /app -path /app/target -prune -o -path /app/node_modules -prune \
      -o -user 0 -exec chown $(id -u):$(id -g) {} +" >/dev/null 2>&1 || true
    git -C "$root" worktree remove --force "$work" 2>/dev/null || true
  fi
}
trap cleanup EXIT

fail() {
  status failure "$1 failed on the owner's machine" || true
  echo "verify: $1 failed." >&2
  exit 1
}

step() {
  local name="$1"
  shift
  echo "==> $name"
  "$@" || fail "$name"
}

# The same docs-only rule as the workflow: every changed path ends in `.md` or
# lives under `docs/`, and renames count as a deletion plus an addition.
code=false
while IFS= read -r file; do
  case "$file" in
    *.md | docs/*) ;;
    *)
      code=true
      break
      ;;
  esac
done < <(git -C "$work" diff --no-renames --name-only "origin/$base_ref...$head_sha")

status pending "running on the owner's machine"

if [[ "$code" == true ]]; then
  step "Build the development image" \
    docker build --quiet -t "$image" -f "$work/docker/dev.Dockerfile" "$work"
  step "Install the window's dependencies" run pnpm install --frozen-lockfile
  step "Typecheck the window" run pnpm typecheck
  step "Build the window" run pnpm build
  step "Build the Remote" run pnpm build:remote
  echo "==> Check the committed Remote artifact is current"
  stale="$(git -C "$work" status --porcelain -- crates/host-wire/remote)"
  if [[ -n "$stale" ]]; then
    printf '%s\n' "$stale"
    fail "the committed Remote artifact check (run pnpm build:remote and commit it)"
  fi
  step "Check the Remote stays out of the window's bundle" test ! -e "$work/dist/remote.html"
  step "Test the window" run pnpm test
  step "Check Rust formatting" run cargo fmt --check
  step "Clippy" run cargo clippy --all-targets -- -D warnings
  step "Test the Rust workspace" run cargo test --workspace --no-fail-fast
else
  echo "Docs only: the suites are skipped."
fi

status success "passed on the owner's machine"
echo "verify: passed for $head_sha."

if [[ "$merge" == true && ",$labels," == *",automerge,"* ]]; then
  gh pr merge "$pr" --merge --match-head-commit "$head_sha"
elif [[ "$merge" == true ]]; then
  echo "PR #$pr has no automerge label; not merging."
fi
