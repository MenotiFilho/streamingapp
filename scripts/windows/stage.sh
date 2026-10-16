#!/usr/bin/env bash
# Stage the Host where Windows can build and run it: a Windows path, as a copy,
# carrying the built frontend that `dist/` holds and git does not.
#
#   scripts/windows/stage.sh /mnt/c/Users/<you>/streamingapp-verify
#
# Run from WSL, in the repo root. `verify.ps1` runs the walkthrough afterwards.
set -euo pipefail

target="${1:?usage: stage.sh <windows-path-as-seen-from-wsl>}"
repo="$(git rev-parse --show-toplevel)"
cd "$repo"

if [ ! -f dist/index.html ]; then
  echo "no frontend in ./dist — run 'docker compose exec dev pnpm build' first" >&2
  exit 1
fi

mkdir -p "$target"
# Committed files only: no target/, no node_modules/, no .git.
git archive HEAD | tar -x -C "$target"
rm -rf "$target/dist"
cp -r dist "$target/dist"
# The tree gets the scripts as they are now, not as they were last committed, so
# the walkthrough can be edited and re-run without a commit in between.
cp scripts/windows/*.ps1 "$target/scripts/windows/"

echo "staged $(git rev-parse --short HEAD) at $target"
if [ -f "$target/fixture/verify-controls.mkv" ]; then
  echo "fixture video: $(wc -c <"$target/fixture/verify-controls.mkv") bytes (scripts/windows/fixture-video.sh)"
else
  echo "no fixture video yet — 'scripts/windows/fixture-video.sh $target' makes one,"
  echo "which is what lets a walkthrough play a Stream without a debrid Addon"
fi
echo "next: powershell -NoProfile -ExecutionPolicy Bypass -File 'C:\\...\\scripts\\windows\\build.ps1' -Tree '<windows path>'"
