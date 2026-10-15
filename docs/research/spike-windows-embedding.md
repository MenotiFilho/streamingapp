# Spike: HDR-capable mpv embedding on Windows (`wid` + transparent overlay)

Ticket: #3. Run 2026-10-15 on the Windows host (AMD Radeon RX 9060 XT, Windows 11,
LG 25UM58 2560×1080 8-bit SDR).

**Prototype code lives on the `prototype/windows-embed` branch**, not on `main`:
`spike/windows-embed/`, with its driver scripts in `spike/windows-embed/scripts/`.
It is kept as a primary source for the shape this needs to take, and is
superseded by #7.

## Verdict

**ADR-0003 and ADR-0007 hold on Windows.** mpv owned the video surface while our
own UI was drawn over it in the same window, hardware decode engaged, and the
frame cadence stayed clean. Nothing in the shape needs to change for Windows.

## What was proven, and how

| Question | Result |
|---|---|
| Does libmpv embed into our window as a child window? | **Yes.** `EnumChildWindows` found a child of class `mpv` under our HWND on the first poll (~250 ms). |
| Does mpv keep its own swapchain? | **Yes.** `vo=gpu-next`, `gpu-context=d3d11`, `hwdec=d3d11va`, `vo-configured=yes`, `video-params.pixelformat=d3d11`, `hw-pixelformat=nv12`. mpv is not rendering into our FBO — this is the HDR-preserving path. |
| Can a transparent webview draw above it? | **Yes.** Tauri `"transparent": true` plus mpv's child window pushed to `HWND_BOTTOM` produced a visibly transparent overlay: our control bar and props panel sat over live video, with the video visible through the page background. Confirmed by screenshot at native resolution. |
| Does input reach the webview over the video area? | **Yes.** A synthesized click at the centre of the video logged `WEBVIEW GOT CLICK: video-area x=589 y=446`. The user's own clicks on overlay buttons are also in the log. |
| Can the overlay drive mpv? | **Yes.** From JS: `COMMAND ["seek","50","absolute-percent"] -> rc=0`, `COMMAND ["set","video-crop","1600x600+400+600"] -> rc=0`, speed, aspect and subtitle toggles likewise, all `rc=0`. The screenshot after the crop shows the frame actually cropped and `video-crop` reflected as a property. |
| Frame pacing? | 4K60 for ~20 s: **drops 0→4**, `display-fps=60`, `est-vf-fps=60`. |

## Mechanism recipe (the parts that matter)

1. **HWND**: found by window title (`FindWindowW`), not via a framework accessor —
   avoids depending on Tauri's internal window API.
2. **`wid` before `mpv_initialize`** — `wid` is an option, so it must be set on the
   handle before initialization, along with `vo=gpu-next`, `gpu-api=d3d11`,
   `gpu-context=d3d11`, `hwdec=auto-safe`, `target-colorspace-hint=yes`.
3. **Adopt the child**: poll `EnumChildWindows` for class `mpv`, then
   `SetWindowPos(child, HWND_BOTTOM, 0,0, client_w, client_h, SWP_NOACTIVATE|SWP_SHOWWINDOW)`
   and add `WS_EX_TRANSPARENT` to its `GWL_EXSTYLE`. Doing this *after* `loadfile`
   is fine; the child exists almost immediately.
4. **Transparency** came from Tauri's `transparent: true` alone — no COM call to
   `SetDefaultBackgroundColor` was needed. The page must use
   `background: transparent`.

## Findings that cost time, recorded so they don't again

- **`set video-crop no` fails** with `rc=-12` (`MPV_ERROR_COMMAND`) on mpv 0.41,
  while setting a crop rectangle succeeds. Clearing a crop needs a different
  spelling (probably the full-frame rectangle) — relevant to ticket #7.
- **`tauri-build` requires `icons/icon.ico`** for the Windows resource even in a
  dev build; a 4 KB hand-made ICO is enough (`spike/windows-embed/icons/`).
- **`frontendDist` is resolved relative to the config file's directory.** With the
  config at the crate root it is `./dist`, not `../dist` (which is right only for
  the conventional `src-tauri/` layout).
- **The shinchiro dev bundle ships `libmpv.dll.a` (MinGW) and no `mpv.lib`**, plus
  no `render_d3d11.h`. This spike sidesteps the whole problem by loading
  `libmpv-2.dll` at runtime with `libloading`, so no import library is needed at
  all. The linked `libmpv2` crate will need `mpv.lib` generated from the DLL
  exports (`dumpbin` → `.def` → `lib.exe`), or the same runtime-loading trick.
- **mpv 0.41 exposes `menu-data`** — its own menu model (tracks, chapters, speed,
  aspect, devices, profiles) as structured data an external client can render.

## Not verified (explicitly)

- **HDR10 / Dolby Vision passthrough.** No HDR display exists on this machine;
  `video-params` reported `"light":"display"` (SDR). This is the deferred half of
  #3 and needs different hardware.
- **HEVC / AV1 at 4K.** The test clip was H.264, so `d3d11va` was proven for H.264
  only.
- **X11 and Wayland overlays.** Untested here; Ventic's report that X11 cannot
  composite a webview above an mpv child window (falling back to window region
  cut-outs) is the open question, and it is what the container half of #3 was for.
- **Long-run stability, audio, ASS subtitle rendering, seek previews.** Out of
  scope for this spike.
- **`libmpv2` (the crate) on Windows.** The spike used raw FFI via `libloading`;
  the crate's Windows linking story is still unverified.
