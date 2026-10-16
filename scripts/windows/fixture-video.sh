#!/usr/bin/env bash
# A short video for the walkthrough's Addon fixture, generated where ffmpeg is:
# the dev container. The Windows side has no encoder of its own, and hardware
# decode needs a *compressed* stream — a raw one would say nothing about whether
# a GPU decoder engaged.
#
#   scripts/windows/fixture-video.sh /mnt/c/Users/<you>/streamingapp-verify
#
# ffmpeg writes to a pipe, so nothing lands in the repo: the bytes go straight
# into the staged tree, where `fixture-addon.ps1` serves them.
set -euo pipefail

target="${1:?usage: fixture-video.sh <windows-path-as-seen-from-wsl>}"
repo="$(git rev-parse --show-toplevel)"
cd "$repo"

mkdir -p "$target/fixture"
echo "encoding $(docker compose exec -T dev ffmpeg -version 2>/dev/null | head -1) ..."

docker compose exec -T dev ffmpeg -hide_banner -loglevel error -nostdin \
  -f lavfi -i "testsrc2=duration=120:size=1280x720:rate=30" \
  -c:v libx264 -preset veryfast -crf 28 -pix_fmt yuv420p \
  -movflags frag_keyframe+empty_moov -f mp4 pipe:1 \
  > "$target/fixture/verify-720p.mp4"

echo "wrote $target/fixture/verify-720p.mp4 ($(wc -c <"$target/fixture/verify-720p.mp4") bytes)"
echo "next: run fixture-addon.ps1 on the Windows side, pointed at that file"
