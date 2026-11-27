#!/usr/bin/env bash
# Rebuilds streamingapp-ui.fig and renders every screen to preview/ with figlens.
# Everything runs in a throwaway node container; nothing is installed on the host.
set -euo pipefail
D="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$D/tools"
[ -f "$D/assets/meta.json" ] || { echo "no assets: run scripts/fetch-assets.sh first" >&2; exit 1; }
docker run --rm -u "$(id -u):$(id -g)" -e HOME=/d/tools/.home -e KEEP_LINKS="${KEEP_LINKS:-0}" -v "$D":/d -w /d/tools node:24 bash -euc '
  [ -d node_modules/@phosphor-icons/core ] || npm i --no-audit --no-fund @open-pencil/cli@0.17.0 @runkids/figlens@0.14.7 @phosphor-icons/core@2.1.1 >/dev/null
  export PATH=/d/tools/node_modules/.bin:$PATH
  printf "<div></div>" > seed.html
  openpencil import seed.html -o next.fig >/dev/null
  openpencil eval next.fig --stdin --write < /d/scripts/build.js
  mkdir -p /d/preview && rm -f /d/preview/*.jpg
  figlens tree next.fig --top-frames | while read -r id _ rest; do
    name=$(printf "%s" "$rest" | cut -d\" -f2)
    figlens export next.fig "$id" "/d/preview/${name%% *}.jpg" >/dev/null && echo "rendered $name"
  done
  # renamed into place so a viewer never reads a half-written file
  mv next.fig /d/streamingapp-ui.fig
'
ls -la "$D/streamingapp-ui.fig"
