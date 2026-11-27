#!/usr/bin/env bash
# Downloads the Cinemeta/metahub artwork and metadata the mockup draws into assets/,
# and takes the TMDB mark from the client's own assets. Runs in a throwaway Python
# container; nothing is installed on the host. The artwork is third-party and is
# not committed: run this once before scripts/build.sh.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$D/../../.." && pwd)"
mkdir -p "$D/assets"
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$D":/d -w /d python:3.12-slim \
  sh -euc 'pip install -q --user --disable-pip-version-check pillow && python scripts/assets.py assets'
# the mark's CSS-class fill becomes a plain fill, which the .fig importer reads
sed -e 's/class="cls-1"/fill="#3CBEC9"/g' -e 's#<defs>.*</defs>##' \
  "$REPO/src/assets/tmdb-logo.svg" > "$D/assets/tmdb-logo.svg"
