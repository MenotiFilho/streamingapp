#!/usr/bin/env bash
# Run one command in the development image, with the repository at /app.
#
# The same image `docker compose` uses, so CI and a by-hand run share the
# toolchain. `node_modules` and `target` are named volumes: they are build
# output, not parts of the checkout, and keeping them out of the bind mount
# keeps a CI run from leaving root-owned build trees behind.
set -euo pipefail

root="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
image="${IMAGE:-streamingapp-dev:ci}"

docker run --rm --init \
  -v "${root}:/app" \
  -v streamingapp-cargo-target:/app/target \
  -v streamingapp-node-modules:/app/node_modules \
  -w /app \
  "${image}" \
  "$@"
