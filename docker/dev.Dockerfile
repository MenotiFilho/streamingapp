# Dev toolchain for the Host: Rust + libmpv + Node/pnpm + Tauri 2 Linux deps.
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
    PATH=/usr/local/cargo/bin:$PATH

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

WORKDIR /app
CMD ["sleep", "infinity"]
