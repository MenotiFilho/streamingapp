# mpv owns the video swapchain; the Host owns the window

Status: revised. The first version of this ADR said playback "runs in a libmpv
instance inside the Host process, rendering into a surface the Host owns". That
premise is contradicted by research (`docs/research/media-quality-hdr-audio-passthrough.md`):
mpv's render API does not run libplacebo (mpv #10810 open since 2022, PR #16818
still a draft), and `--target-colorspace-hint` — HDR passthrough — requires
`--vo=gpu-next`. A render-API client therefore cannot pass HDR through at all,
and any toolkit that composites mpv's frames into its own texture caps them
further (Flutter's texture registrar exposes only 8-bit RGBA/BGRA; media-kit #615
says HDR passthrough "is currently not possible with flutter textures at all").

Decision: HDR passthrough is a hard requirement, so **mpv owns the video output
and its swapchain** (`--vo=gpu-next`, with its own window or a child window via
`--wid`), and the Host composites *its own UI* over or around mpv's surface by
OS-level means (transparent click-through windows, or window-region cut-outs)
rather than drawing video itself. We still reject **uosc** as the player UI for
the original reason: its menus are built inside mpv from `input.conf` and
in-process scripts, with no way for an external client to inject items, so a
remote could never drive it. The player OSD stays ours.

Consequences: on platforms with no `--wid` (native Wayland, macOS) mpv cannot be
embedded in our window at all, so the Host falls back to a separate mpv window
and/or draws its OSD into mpv's own surface (`osd-overlay` for text/ASS,
`overlay-add` for bitmap overlays). Autocrop is unaffected either way: it is a
stock mpv script driving the `video-crop` property.
