#!/usr/bin/env bash
# Build the Torrent engine, in the dev container (ADR-0042 §1).
#
#   docker compose exec dev crates/host-torrent/build.sh
#
# Two builds of the same Go program, both `CGO_ENABLED=0` so no C toolchain for
# the target is needed:
#
#   crates/host-torrent/out/streamingapp-torrent.exe   Windows, for the installer
#   target/torrent/streamingapp-torrent                native, for `cargo run` in
#                                                      the container (the Host finds
#                                                      it beside target/debug/)
#
# The Windows one goes under the checkout, not under `target/`, because `target/`
# is a container volume and `scripts/windows/stage.sh` copies from the host side.
# `engine/THIRD-PARTY.md` is regenerated first (`licenses.sh`), so the licence
# notice that ships with the binary is the one for the code that was just built.
#
# Environment, for a caller that wants the files elsewhere:
#   TORRENT_WINDOWS_OUT   directory for the Windows build   (default: out/ here)
#   TORRENT_NATIVE_OUT    directory for the native build    (default: target/torrent/)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
engine="$here/engine"
windows_out="${TORRENT_WINDOWS_OUT:-$here/out}"
native_out="${TORRENT_NATIVE_OUT:-$root/target/torrent}"

mkdir -p "$windows_out" "$native_out"

echo "==> licences"
"$here/licenses.sh"

cd "$engine"

echo "==> windows/amd64 -> $windows_out/streamingapp-torrent.exe"
GOOS=windows GOARCH=amd64 CGO_ENABLED=0 \
  go build -trimpath -o "$windows_out/streamingapp-torrent.exe" .

echo "==> native -> $native_out/streamingapp-torrent"
CGO_ENABLED=0 go build -trimpath -o "$native_out/streamingapp-torrent" .

# Run as root in the container, the output would be root-owned on the host's side
# of the bind mount, where it cannot be removed without `sudo`. Hand it to whoever
# owns the checkout.
if [ "$(id -u)" = 0 ]; then
  owner="$(stat -c '%u:%g' "$root")"
  chown -R "$owner" "$windows_out" "$engine/THIRD-PARTY.md"
fi

ls -l "$windows_out/streamingapp-torrent.exe" "$native_out/streamingapp-torrent"
file "$windows_out/streamingapp-torrent.exe" "$native_out/streamingapp-torrent"
