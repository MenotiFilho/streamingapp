#!/usr/bin/env bash
# Run one command in the development image, with the repository at /app.
#
# The same image `docker compose` uses, so CI and a by-hand run share the
# toolchain. `node_modules` and `target` are named volumes: they are build
# output, not parts of the checkout, and keeping them out of the bind mount
# keeps a CI run from leaving root-owned build trees behind.
#
# CI overrides the build directories with host paths (CI_CARGO_HOME,
# CI_CARGO_TARGET_DIR, CI_NODE_MODULES, CI_PNPM_STORE) so `actions/cache` can
# keep the cargo registry and the compiled dependencies between runs. It also
# runs the container as the runner's user: the cache is tarred by that user, and
# root-owned build output cannot be saved. A local run leaves the variables
# unset and keeps the named volumes and root, exactly as before.
set -euo pipefail

root="${GITHUB_WORKSPACE:-$(git rev-parse --show-toplevel)}"
image="${IMAGE:-streamingapp-dev:ci}"

mounts=(-v "${root}:/app")
envs=()
user=()

if [[ -n "${CI_CARGO_HOME:-}" ]]; then
  mounts+=(-v "${CI_CARGO_HOME}:/cargo-home")
  envs+=(-e CARGO_HOME=/cargo-home -e HOME=/cargo-home)
  user=(--user "$(id -u):$(id -g)")
else
  mounts+=(
    -v streamingapp-cargo-registry:/usr/local/cargo/registry
    -v streamingapp-cargo-git:/usr/local/cargo/git
  )
fi

if [[ -n "${CI_CARGO_TARGET_DIR:-}" ]]; then
  mounts+=(-v "${CI_CARGO_TARGET_DIR}:/app/target")
else
  mounts+=(-v streamingapp-cargo-target:/app/target)
fi

if [[ -n "${CI_NODE_MODULES:-}" ]]; then
  mounts+=(-v "${CI_NODE_MODULES}:/app/node_modules")
else
  mounts+=(-v streamingapp-node-modules:/app/node_modules)
fi

if [[ -n "${CI_PNPM_STORE:-}" ]]; then
  mounts+=(-v "${CI_PNPM_STORE}:/pnpm-store")
fi

# Pass the few cargo settings the workflow asks for into the container; docker
# does not inherit the runner's environment.
for name in CARGO_INCREMENTAL CARGO_TERM_COLOR RUST_BACKTRACE; do
  if [[ -n "${!name:-}" ]]; then
    envs+=(-e "${name}=${!name}")
  fi
done

docker run --rm --init "${user[@]}" "${mounts[@]}" "${envs[@]}" -w /app "${image}" "$@"
