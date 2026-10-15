# Stack: Tauri 2 + React, libmpv linked in-process, mpv owning the video surface

The Host is a Tauri 2 process: Rust owns state, addon transport and playback, and
links libmpv in-process through `libmpv2`, embedding it into a child window with
`wid` so that mpv keeps its own VO, swapchain, present and vsync (the only way to
keep HDR passthrough — see ADR-0003). The UI is React/TypeScript in the Tauri
webview. On Windows the player UI is a transparent, click-through webview layered
over mpv's child window (mpv at `HWND_BOTTOM`, `WS_EX_TRANSPARENT` +
`HTTRANSPARENT`, WebView2 background alpha 0) which allows a full-fidelity OSD
with HDR intact. On Linux X11 the same shape is intended but unproven — Ventic
needed window-region cut-outs there — so `osd-overlay` into mpv's surface is the
documented fallback. On Wayland there is no `wid` at all: mpv gets its own window
and the player UI is pushed into mpv's surface with `osd-overlay`.

Rejected, with reasons: Flutter/`media_kit`, Compose Multiplatform, egui +
`libmpv2`, Avalonia and Qt's `mpvqt` all composite mpv's frames through the
render API, which has no libplacebo/`gpu-next` backend, so HDR passthrough is
impossible and the texture paths cap at 8-bit; Iced, Slint, GPUI and MAUI have no
working path at all; Electron is the same shape as Tauri with a heavier runtime.

Consequences: the app is a derivative work of GPL mpv, which is exactly what
ADR-0004 chose for; Windows requires a bundled libmpv build while Linux can link
the system one; the X11 overlay needs an early spike; and the player UI is
deliberately different per platform rather than uniformly mediocre.
