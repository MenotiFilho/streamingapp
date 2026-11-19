#!/usr/bin/env bash
# Build the Windows NSIS installer on this machine for a commit and publish it
# as a GitHub Release.
#
#   scripts/cd.sh                    build and publish origin/main
#   scripts/cd.sh <ref>              build and publish <ref>
#   scripts/cd.sh [ref] --dry-run    build the installer and checksum only
#
# Like `scripts/ci.sh`, this runs on the owner's machine rather than GitHub's
# runners: the frontend is built inside the `streamingapp-dev:ci` container from
# a throwaway git worktree, staged into a clean temporary directory on the
# Windows filesystem (wiped on exit), compiled and bundled into an NSIS
# per-user setup `.exe` with `libmpv-2.dll` and the Torrent engine
# (`streamingapp-torrent.exe`, cross-compiled in the same container) beside
# `streamingapp.exe`, and uploaded to GitHub Releases with a `.sha256` checksum file.
#
# The Windows `libmpv` bundle, `cargo-tauri` binary, and Cargo `target/`
# directory are kept in `%LOCALAPPDATA%\streamingapp-cd-cache` between runs so
# release builds stay incremental without touching `streamingapp-verify` or any
# running Host window.
set -euo pipefail

ref="origin/main"
dry_run=false
for arg in "$@"; do
  case "$arg" in
    --dry-run)
      dry_run=true
      ;;
    -*)
      echo "usage: scripts/cd.sh [ref] [--dry-run]" >&2
      exit 1
      ;;
    *)
      ref="$arg"
      ;;
  esac
done

root="$(git rev-parse --show-toplevel)"
repo="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
image="streamingapp-dev:ci"
powershell="/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe"

if [[ ! -x "$powershell" ]]; then
  echo "cd: Windows PowerShell not found at $powershell." >&2
  exit 1
fi

# Fetch main and all tags over HTTPS with gh's credential so the commit count
# and release tag checks see the current remote state without needing an SSH key.
git -C "$root" -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  fetch --quiet --tags "https://github.com/$repo.git" \
  "+refs/heads/main:refs/remotes/origin/main"

target_sha="$(git -C "$root" rev-parse "${ref}^{commit}")"
base_version="$(git -C "$root" show "${target_sha}:src-tauri/tauri.conf.json" | sed -n 's/.*"version":[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
major_minor="${base_version%.*}"
commit_count="$(git -C "$root" rev-list --count "$target_sha")"
version="${major_minor}.${commit_count}"
tag="v${version}"

if [[ "$dry_run" == false ]]; then
  if existing_sha="$(gh api "repos/$repo/git/ref/tags/$tag" --jq .object.sha 2>/dev/null)"; then
    if [[ "$existing_sha" == "$target_sha" ]]; then
      echo "cd: release $tag ($target_sha) is already published."
      exit 0
    fi
    echo "cd: tag $tag already points to $existing_sha (expected $target_sha)." >&2
    exit 1
  fi
fi

win_localappdata="$(
  cd /mnt/c && "$powershell" -NoProfile -NonInteractive \
    -Command '[Console]::Write($env:LOCALAPPDATA)' </dev/null | tr -d '\r'
)"
if [[ -z "$win_localappdata" ]]; then
  echo "cd: could not resolve Windows %LOCALAPPDATA%." >&2
  exit 1
fi

win_cache_win="${win_localappdata}\\streamingapp-cd-cache"
win_cache_wsl="$(wslpath -u "$win_cache_win")"
win_stage_win="${win_localappdata}\\Temp\\streamingapp-cd-${target_sha:0:12}-$$"
win_stage_wsl="$(wslpath -u "$win_stage_win")"

work="$(git -C "$root" rev-parse --git-common-dir)/cd-worktree"
work="$(cd "$(dirname "$work")" && pwd)/$(basename "$work")"
git -C "$root" worktree remove --force "$work" 2>/dev/null || rm -rf "$work"
git -C "$root" worktree prune
git -C "$root" worktree add --quiet --detach "$work" "$target_sha"

run() {
  GITHUB_WORKSPACE="$work" IMAGE="$image" CI_PNPM_STORE=streamingapp-pnpm-store \
    "$root/.github/scripts/dev-run.sh" "$@"
}

cleanup() {
  if [[ -d "$work" ]]; then
    run sh -c "find /app -path /app/target -prune -o -path /app/node_modules -prune \
      -o -user 0 -exec chown $(id -u):$(id -g) {} +" >/dev/null 2>&1 || true
    git -C "$root" worktree remove --force "$work" 2>/dev/null || true
  fi
  if [[ -n "${win_stage_wsl:-}" && -d "$win_stage_wsl" ]]; then
    rm -rf "$win_stage_wsl" 2>/dev/null || true
  fi
}
trap cleanup EXIT

step() {
  local name="$1"
  shift
  echo "==> $name"
  "$@"
}

echo "cd: building $tag ($target_sha)"

step "Build the development image" \
  docker build --quiet -t "$image" -f "$work/docker/dev.Dockerfile" "$work"
step "Install the window's dependencies" \
  run pnpm install --frozen-lockfile --store-dir=/pnpm-store
step "Build the window" \
  run pnpm build

# The Torrent engine is Go, cross-compiled to Windows here, in the pinned image,
# and staged with its licence notice; Windows has no Go.
step "Build the Torrent engine" \
  run crates/host-torrent/build.sh

rm -rf "$win_stage_wsl"
step "Stage the tree to a clean Windows directory ($win_stage_win)" \
  bash -c "cd \"$work\" && TORRENT_ENGINE_PREBUILT=1 ./scripts/windows/stage.sh \"$win_stage_wsl\""

step "Build the Windows NSIS installer ($version)" \
  bash -c "cd /mnt/c && \"$powershell\" -NoProfile -NonInteractive -ExecutionPolicy Bypass \
    -File '${win_stage_win}\\scripts\\windows\\build.ps1' \
    -Tree '$win_stage_win' \
    -CacheDir '$win_cache_win' \
    -Bundle \
    -Version '$version' </dev/null"

nsis_dir="$win_cache_wsl/target/release/bundle/nsis"
installer="$(find "$nsis_dir" -maxdepth 1 -type f -name "streamingapp_${version}_*-setup.exe" | head -n 1)"
if [[ -z "$installer" || ! -f "$installer" ]]; then
  echo "cd: no installer found matching streamingapp_${version}_*-setup.exe in $nsis_dir" >&2
  exit 1
fi

installer_dir="$(dirname "$installer")"
installer_name="$(basename "$installer")"
checksum="${installer}.sha256"
(
  cd "$installer_dir"
  sha256sum "$installer_name" > "${installer_name}.sha256"
)

echo "cd: installer ready at $installer"
echo "cd: sha256 $(cat "$checksum")"

if [[ "$dry_run" == true ]]; then
  echo "cd: --dry-run set; skipping GitHub Release creation for $tag."
  exit 0
fi

step "Publish GitHub Release $tag" \
  gh release create "$tag" \
    --repo "$repo" \
    --target "$target_sha" \
    --title "$tag" \
    --generate-notes \
    --latest \
    "$installer" \
    "$checksum"

git -C "$root" -c credential.helper= -c 'credential.helper=!gh auth git-credential' \
  fetch --quiet --tags "https://github.com/$repo.git"

echo "cd: published $tag for $target_sha."
