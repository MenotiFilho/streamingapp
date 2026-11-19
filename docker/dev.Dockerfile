# Dev toolchain for the Host: Rust + libmpv + Node/pnpm + Go + Tauri 2 Linux deps.
#
# Build:  docker compose build
#         docker build -f docker/dev.Dockerfile -t streamingapp-dev .
# Shell:  docker compose run --rm dev bash
#
# The container is for building, testing and non-GPU bring-up. HDR passthrough
# and real hardware-decode behaviour are verified on the Windows-native build.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=C.UTF-8 \
    RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    GOPATH=/go \
    GOCACHE=/go/cache \
    GOFLAGS=-buildvcs=false \
    PATH=/usr/local/cargo/bin:/usr/local/go/bin:/go/bin:$PATH

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential pkg-config cmake git curl wget file ca-certificates xz-utils \
      clang libclang-dev \
      mpv libmpv-dev ffmpeg \
      libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev libxdo-dev \
      libssl-dev libsoup-3.0-dev \
      libgl1-mesa-dri libegl1 libgles2 mesa-vulkan-drivers va-driver-all \
      libasound2t64 pulseaudio-utils libwayland-client0 \
      jq ripgrep \
  && rm -rf /var/lib/apt/lists/*

# Rust: stable + clippy + rustfmt. libmpv2-sys builds bindings, hence clang/libclang-dev above.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
  | sh -s -- -y --profile minimal --default-toolchain stable -c clippy -c rustfmt

# Node 22 + pnpm for the Tauri frontend.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && npm install -g pnpm@latest \
 && rm -rf /var/lib/apt/lists/*

# Go, for the Torrent engine (crates/host-torrent/engine, ADR-0042 §1). The current
# stable toolchain, pinned by version and checked against its published sha256;
# cross-compiled to Windows from here with CGO_ENABLED=0, so no C toolchain for
# the target is needed.
ARG GO_VERSION=1.27.4
ARG GO_SHA256_AMD64=7226736c2339719cda28fbf3a54d71aa63bcefe376e98cef00034268dab24840
ARG GO_SHA256_ARM64=3392582988a273a87ab5043ee1b2c9c17a2c3c00580bf9326c47a2e0aaaeac92
RUN arch="$(dpkg --print-architecture)" \
 && case "$arch" in \
      amd64) sha="$GO_SHA256_AMD64" ;; \
      arm64) sha="$GO_SHA256_ARM64" ;; \
      *) echo "no Go build pinned for $arch" >&2; exit 1 ;; \
    esac \
 && curl -fsSL -o /tmp/go.tgz "https://go.dev/dl/go${GO_VERSION}.linux-${arch}.tar.gz" \
 && echo "$sha  /tmp/go.tgz" | sha256sum -c - \
 && tar -C /usr/local -xzf /tmp/go.tgz \
 && rm /tmp/go.tgz \
 && mkdir -p /go \
 && chmod 1777 /go

WORKDIR /app
CMD ["sleep", "infinity"]
