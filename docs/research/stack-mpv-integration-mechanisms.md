# Desktop-app stacks × libmpv: integration mechanism, frame path, and retained control surface

**Date of research:** 2026-10-15. All repositories, raw files, headers and package metadata below were read on this date unless a different date is stated.
**Scope:** verifiable facts only, with exact URLs, file paths, code quotes, versions and licenses. No recommendations. Inferences are labelled `[inference]`. Things I could not confirm are collected in §10.
**Question answered per stack:** (a) exact integration mechanism, (b) the path a decoded frame takes to the screen — copies/blits, swapchain owner, presenter, vsync, (c) whether the app can reach arbitrary mpv properties/commands/observers and load mpv scripts (`--script`, e.g. `TOOLS/lua/autocrop.lua`), (d) evidence of 4K/HEVC/AV1 quality, (e) platform coverage of the mechanism. Plus: what each mechanism loses relative to running plain `mpv` (§9).

**Local artefacts used** (clones/fetches made during this research):
`/tmp/opencode/repos/media-kit`, `/tmp/opencode/repos/cove`, `/tmp/opencode/repos/jellyfin-media-player`, `/tmp/opencode/repos/egui-sharkplayer`, `/tmp/opencode/repos/ventic`; `/tmp/opencode/mpv-master` (mpv `master` tarball, `MPV_VERSION` = `0.41.0-UNKNOWN`); `/tmp/opencode/mpvqt` (KDE `mpvqt` raw files); `/tmp/opencode/crates/libmpv2-6.0.0` (crates.io tarball); `/tmp/opencode/ext/*` and `/tmp/opencode/harbor_files/*` (previously fetched harbour/ventic/shell-ng/mpv-examples/mpv.net files).

---

## 0. Summary table

| # | Stack | Mechanism (verified) | App owns swapchain? | mpv renderer used | mpv scripts? | HDR passthrough reachable? | Platforms of the mechanism |
|---|---|---|---|---|---|---|---|
| 1 | Tauri 2 + WebView2/WebKitGTK + `--wid` | In-process libmpv with `wid=<app HWND>` (harbor, shell-ng) **or** an external `mpv` process with `--wid` + JSON IPC (ventic) | **No — mpv owns it** | Whatever mpv picks (`gpu-next`/`gpu` → `d3d11`) | Yes (full mpv) | **Yes** on Windows/D3D11 | X11, win32, Android (`--wid`); not macOS, not Wayland |
| 2 | Tauri 2 + render API (OpenGL) under/over webview | libmpv render API into an app GL surface (macOS `NSOpenGLView`; Linux GTK `Overlay`+`GLArea`) | Yes (app FBO) | `libmpv` VO → `render_backend_gpu` (gl_video, **not** libplacebo) | Yes (full libmpv) | **No** (see §9) | OpenGL wherever mpv runs; Windows needs ANGLE |
| 3 | Flutter + `media_kit` / `media_kit_video` | libmpv render API + Flutter texture registry; **Windows**: ANGLE/EGL + D3D11 shared texture; **Linux**: isolated EGL context + `EGLImage`; **Android**: `--wid` on `Surface` + `vo=mediacodec_embed` | Yes (app FBO) | `libmpv` VO, OpenGL | **No via public API** (options map is hardcoded) | No (8-bit BGRA/RGBA8 targets) | Win, Linux, macOS, iOS, Android; Web ≠ libmpv |
| 4 | egui (glow) + `libmpv2` render API | libmpv render API into an app `RGBA8` FBO, blitted into egui via `CallbackFn` | Yes | `libmpv` VO, OpenGL only | Yes, **if** the app calls `Mpv::with_initializer` (sharkplayer itself does not) | No | OpenGL (Windows/Linux/macOS); crate defaults `wayland`+`x11` |
| 5 | Qt6/QML + render API into `QQuickFramebufferObject` | mpv render API into the QQuickFBO's FBO (`mpv-examples/libmpv/qml`, Stremio shell, KDE `MpvQt` used by Jellyfin) | Yes (Qt's FBO) | `libmpv` VO → `render_backend_gpu` | Yes (Qt-level `command`/`setProperty`; pre-init via handle) | No; and Qt 6 requires forcing the OpenGL RHI | Qt forces OpenGL RHI; documented "legacy" class |
| 6 | Compose Multiplatform (JVM) + mpv — `coveninja/cove` | Desktop: JNA-bound in-process libmpv, OpenGL render API + `ADVANCED_CONTROL`, into JOGL `GLJPanel`, hosted in Compose `SwingPanel`. Android: mpv-android `MPVLib.attachSurface` + `gpu-context=android` | Yes (JOGL FBO) | `libmpv` VO, OpenGL | Yes (raw `mpv_set_option` before init; app currently only uses `script-opts`) | No | Desktop Linux/Win/macOS + Android (2 mechanisms) |
| 7 | Avalonia / Slint / Iced / Electron / MAUI | Avalonia: yes (GL, not `NativeControlHost`). Slint: yes (one example). Iced: yes (one crate). Electron: yes, but the old shape (Pepper) is dead; `--wid`+IPC is the live shape. MAUI: no libmpv UI integration found | — | — | — | — | — |
| 8 | Jellyfin Media Player (`jellyfin-media-player` → now `jellyfin-desktop`) | Qt 6 + QtWebEngine/WebChannel + **KDE `mpvqt`** = render API into `QQuickFramebufferObject`; `WebEngineView` composited **above** the video (`z: 100`) | Yes (Qt's FBO) | `libmpv` VO → `render_backend_gpu` | Yes (`MpvAbstractItem::command`/`setProperty`) | No HDR options found in its player code | Windows, Linux, macOS (Qt 6, forced OpenGL RHI) |

Key structural fact that explains most of the table: **`--wid` lets mpv keep its own window, VO, swapchain, present and vsync; the render API takes all of that away from mpv and gives the app only a texture, using `vo=libmpv`.** From `include/mpv/client.h` (`https://raw.githubusercontent.com/mpv-player/mpv/master/include/mpv/client.h`, "Embedding the video window"):

> "Using the render API (in render.h) is recommended… There is an older way to embed the native mpv window into your own. You have to get the raw window handle, and set it as `wid` option. **This works on X11, win32, and macOS only.** It's much easier to use than the render API, but also has various problems." *(the header says macOS; the manual's `--wid` text lists X11/win32/Android and not macOS — a documented inconsistency, see §9.1)*

---

## 1. Tauri 2 + WebView2/WebKitGTK with mpv embedded via `--wid`

### 1.1 (a) Exact integration mechanism

**Harbor — `github.com/9000000/harbor@main` (MIT, 3★, created 2026-06-04; `Cargo.toml` version `0.8.5`).** Windows path, `src-tauri/src/mpv.rs`:

```rust
if let Some(hwnd) = embed_hwnd {
    #[cfg(windows)]
    {
        let hwnd_i64: i64 = hwnd.parse().map_err(|e| format!("parse wid {}: {}", hwnd, e))?;
        init.set_property("wid", hwnd_i64).map_err(|e| format!("set wid={}: {}", hwnd_i64, e))?;
    }
```

`embed_hwnd` comes from the Tauri webview window (`app.get_webview_window("main")?.hwnd()`). This is set **pre-init** inside `Mpv::with_initializer`. Post-init (`mpv_start`) the child is found by class name and repositioned:

```rust
let is_mpv = class_name == "mpv" || class_name.starts_with("mpv ") || (class_name.is_empty() && title.starts_with("Harbor"));
...
let _ = SetWindowPos(target, Some(HWND_BOTTOM), x, y, w as i32, h as i32, SWP_NOACTIVATE | SWP_SHOWWINDOW);
let want_ex = cur_ex | WS_EX_TRANSPARENT.0 as i32;
let _ = SetWindowLongW(target, GWL_EXSTYLE, want_ex);
let _ = SetWindowSubclass(target, Some(mpv_subclass_proc), HARBOR_MPV_SUBCLASS_ID, 0);
```

and the click-through subclass proc:

```rust
unsafe extern "system" fn mpv_subclass_proc(...) -> LRESULT {
    use windows::Win32::UI::WindowsAndMessaging::{HTTRANSPARENT, WM_NCHITTEST};
    if msg == WM_NCHITTEST {
        return LRESULT(HTTRANSPARENT as isize);
    }
    ...
}
```

**The transparency trick is webview-side, not window-side.** `src-tauri/tauri.conf.json` sets `"transparent": false` and `"decorations": false`; `src-tauri/src/webview_helpers.rs` instead forces the WebView2 controller's default background to fully transparent:

```rust
let controller = webview.controller();
match controller.cast::<ICoreWebView2Controller2>() {
    Ok(controller2) => {
        let color = COREWEBVIEW2_COLOR { A: 0, R: 255, G: 255, B: 255 };
        match controller2.SetDefaultBackgroundColor(color) { ... }
```

So the layering on Windows is: Tauri window (opaque) → mpv child HWND forced to `HWND_BOTTOM` + `WS_EX_TRANSPARENT` + `HTTRANSPARENT` (click-through) → WebView2 child with alpha-0 background on top. mpv's VO is `gpu-next,` when the render API is not used, so **mpv picks `gpu-next`/`gpu` and owns its swapchain inside the child HWND**:

```rust
let use_render_api = cfg!(target_os = "macos") && want_embed;
if !use_render_api {
    if let Err(e) = mpv.set_property("vo", "gpu-next,") { ... }
```

**Ventic — `github.com/ventic/ventic` (MIT, 177★, pushed 2026-10-15).** A real `mpv` **process** with `--wid` and JSON IPC. `src-tauri/src/player.rs` header comments, verbatim:

> "We run a normal mpv process but (a) parent its video into a child X11 window we create inside the app window (`--wid`), positioned/sized to track a DOM element… and (b) drive it entirely over mpv's JSON IPC socket."

> "The native surface always paints **above** the webview, so DOM controls can never be composited on top of the video. Shaping gets the same result the other way round: cut the control-bar rectangles *out* of mpv's window and the page underneath shows through the holes — rendering and input both, since a window's input region follows its bounding shape."

Implementation: `XShapeCombineRegion` bound by hand from `libXext` (`SHAPE_BOUNDING = 0`, `SHAPE_SET = 0`), one whole region built client-side per frame (`XCreateRegion` / `XUnionRectWithRegion` / `XSubtractRegion`), and `GDK_BACKEND=x11` forced before GTK init (`src-tauri/src/player.rs:233`), with the comment "mpv can only embed into an X11 window… XID and playback would fail with 'App window is not X11'." Windows is the same idea with a Win32 region instead of an X shape (`src-tauri/src/player_windows.rs`: `CreateRectRgn` / `CombineRgn(RGN_DIFF)` / `SetWindowRgn`), plus this Windows-specific observation:

> "mpv creates its embedded window **disabled** (`EnableWindow(w32->window, 0)`, unconditional for every `--wid` embed), so unlike on X11 it never receives a click, a wheel notch or a key press".

**Stremio shell-ng — `github.com/Stremio/stremio-shell-ng` (Windows-only, **no declared license** — GitHub API `license: null`, 91★, pushed 2026-10-13).** Also `--wid`, in-process libmpv, in `src/stremio_app/stremio_player/player.rs`:

```rust
let mpv = Mpv::with_initializer(|initializer| {
    set_property!("wid", window_handle as i64);
    ...
    set_property!("hwdec", "auto");
    set_property!("vo", "gpu-next,gpu,");
    let mut options = vec![
        ("gpu-context", "d3d11"),
        ("d3d11-output-format", "auto"),
        ("d3d11-output-csp", "auto"),
        ("target-colorspace-hint", "auto"),
        ("target-colorspace-hint-mode", "target"),
        ("tone-mapping", "bt.2390"),
        ("dither-depth", "auto"),
    ];
    if gpu_video_processing::unified_memory_architecture() {
        options.push(("profile", "fast"));
    } else {
        options.extend([("deband", "yes"), ("scale", "spline36"), ("cscale", "spline36")]);
    }
```

The window handle comes from `tauri::window::Window::hwnd()`.

### 1.2 (b) Frame path

mpv renders into **its own swapchain inside its own child window**, presents and vsyncs there. The app's webview is a **sibling OS window**, so the two surfaces are composited by the OS window manager (DWM on Windows, X11/GTK on Linux), not by any app-level texture handoff. There is **no app-level copy or blit of the decoded frame** in this shape; the only costs are the OS compositing of two child windows and whatever the web UI paints over/under the video.

- Windows: swapchain owner = mpv (`d3d11` context inside the child HWND), presenter = mpv, vsync = mpv's `video-sync`/d3d11 present interval.
- Linux + ventic: X11 child window; X Shape/region controls only the visible/hit-test area, "while the video window itself never resizes".
- Linux + harbor `main`: **no embedding at all** (`get_main_hwnd_str` returns `None` for `not(windows) && not(macos)`), `vo` stays `gpu-next,`, `force-window=yes`, and the frontend's own placeholder text says `"mpv plays in its own window. Controls remain here."` (`src/lib/player/mpv.ts`).

Note the click-through configuration is a real correctness requirement, not a nicety: Tauri discussion #11944 (`https://github.com/orgs/tauri-apps/discussions/11944`) reports `jzade` (PSG-Team): "The child window needs to be **click-through**, not just transparent, or input stops reaching the webview underneath."

### 1.3 (c) Control surface

Full mpv, in both variants:
- In-process (harbor, shell-ng): direct libmpv (`libmpv2` crate + `mpv_observe_property` events). Harbor sets `hwdec`, `target-colorspace-hint`, `tone-mapping`, `glsl-shaders` from a list, `input-default-bindings=no`, `osc=no`, `volume-max=600`, `start=`, etc., and loads mpv scripts through pre-init property setting if the app wants to.
- External process (ventic): mpv's JSON IPC — every command and property, by construction.

Harbor's own pre-init option set (`apply_pre_init`) includes `input-default-bindings=no`, `input-cursor=no`, `osc=no`, `osd-level=0`, `cursor-autohide=200`, `volume-max=600`, `user-agent` spoof, `glsl-shaders` (Anime4K), and `hdr-to-sdr` → `target-colorspace-hint=yes` + `tone-mapping=bt.2446a`. Harbor's Windows path also has `hwdec=auto`; the parked fork (`MenotiFilho/harbor@menoti/slim`) uses `hwdec=d3d11va` when RTX Video is enabled, else `auto-safe`.

### 1.4 (d) 4K / HEVC / AV1 / HDR evidence

- shell-ng is the strongest evidence in this group: it configures mpv's `d3d11` context with `target-colorspace-hint=auto|yes`, `target-colorspace-hint-mode=target`, `tone-mapping=bt.2390`, `d3d11-output-csp=auto|srgb`, `target-trc=auto`, `target-prim=auto|bt.709`, detects the monitor's HDR state through `DisplayConfig` (`monitor_hdr_active` → `display_hdr_active(path)`), and for RTX Video builds a filter chain `d3d11vpp=scaling-mode=nvidia:scale=<x>:format=x2bgr10:nvidia-true-hdr`. Code comment: "Target colorspace follows the display so native HDR still passes through".
- shell-ng's own README claim about the architecture being faster than Qt (`https://github.com/Stremio/stremio-shell-ng` README): "it is about **2-5x more efficient** depending on the use case, as it allows MPV to render directly in the window through it's optimal video output rather than using libmpv to integrate with Qt. This is due to **Qt having a complex rendering pipeline involving ANGLE and multiple levels of composing and drawing to textures, which inhibits full HW acceleration.** Meanwhile in this setup MPV uses whichever pipeline it considers to be optimal (like the mpv desktop app), which is normally **d3d11**, allowing full HW acceleration."
- ventic README: "mpv carries its own ffmpeg, so HEVC, AV1, 10-bit, E-AC-3, DTS and half-downloaded MKVs play with no codec packs."
- **Does HDR survive?** On Windows/D3D11 the answer is yes for mpv's own surface, because mpv owns the swapchain and `--target-colorspace-hint` is documented for D3D11 contexts (see §9.2). The webview layer itself is SDR and cannot be part of the HDR pass; the WebView2 background tricks are about alpha only — Microsoft's `CoreWebView2Controller.DefaultBackgroundColor` doc states "Currently this API only supports opaque colors and transparency. It will fail for colors with alpha values that don't equal 0 or 255 i.e. **translucent colors are not supported**", and Tauri's JS API: "On Windows higher than 7: translucent colors are not supported so any alpha value other than `0` will be replaced by `255`". **No 4K-fps claim and no explicit HEVC/AV1 benchmark was found in harbor or ventic.**

### 1.5 (e) Platform coverage

`--wid` is X11 + win32 + Android only; the manual (`https://mpv.io/manual/master/#options-wid`) enumerates exactly those three and their ID types (X11 `Window`; win32 `HWND`, "Pass it as value cast to uint32_t (all Windows handles are 32-bit)"; Android `android.view.Surface`, "Use with `--vo=mediacodec_embed` and `--hwdec=mediacodec`… or with `--vo=gpu --gpu-context=android`"). It also notes: "If an external window is specified using the `--wid` option, this [geometry] option is ignored." Not Wayland; not macOS.

- ventic: forces `GDK_BACKEND=x11` and states in the README that XWayland is the escape hatch: "launch under GDK_BACKEND=x11 (XWayland)".
- ventic macOS: **does not use `--wid`** — "the platform embeds no other process's window, and mpv's Cocoa output takes no `--wid` — the manual offers it for X11, win32 and Android only. So mpv is not a process there: the app links libmpv, asks for `vo=libmpv`, and draws the frames itself into an OpenGL view *under* the webview, with the page made see-through down to the video box."
- harbor macOS: same, via the render API (§2).

---

## 2. Tauri 2 + libmpv render API (OpenGL), webview composited above or below

### 2.1 (a) Mechanism

**Harbor macOS** (`src-tauri/src/mpv.rs`, `src-tauri/src/mpv_render_mac.rs`). Dispatch:

```rust
let use_render_api = cfg!(target_os = "macos") && want_embed;
...
} else {
    mpv.set_property("vo", "libmpv");
    let _ = mpv.set_property("force-window", "no");
}
```

with pre-init `hwdec=videotoolbox-copy` and `force-window=no` when embedding on macOS. The render surface is an `NSOpenGLView` inserted **below** the WKWebView, and the webview is made non-opaque:

```rust
let view_alloc = NSOpenGLView::alloc(mtm);
let view: Option<Retained<NSOpenGLView>> = msg_send![view_alloc, initWithFrame: bounds, pixelFormat: &*pf];
content_view.addSubview_positioned_relativeTo(view_as_view, NSWindowOrderingMode::Below, Some(reference));
...
let no_num = NSNumber::new_bool(false);
let key = NSString::from_str("drawsBackground");
let _: () = msg_send![wv, setValue: &*no_num, forKey: &*key];
if let Some(layer) = wv.layer() { let _: () = msg_send![&*layer, setOpaque: false]; }
...
RenderParam::ApiType(RenderParamApiType::OpenGl), RenderParam::InitParams(init_params)
...
render.set_update_callback(|| { schedule_redraw(); });
...
render.render::<()>(0, w, h, true)          // FBO 0, flip_y = true
```

Redraw is marshalled to the main thread with `dispatch_async_f(dispatch_get_main_queue(), ...)`.

**`MenotiFilho/harbor@menoti/slim` Linux path** (`src-tauri/src/mpv_render_linux.rs`, 19,784 bytes). It replaces the Tauri window's child box with a GTK3 `Overlay` holding a `GLArea` (video) and the WebKitGTK webview as the overlay child:

```rust
let overlay = gtk::Overlay::new();
let area = gtk::GLArea::new();
area.set_auto_render(false);
area.set_use_es(false);
area.set_has_depth_buffer(false);
area.set_has_stencil_buffer(false);
area.set_app_paintable(true);
area.set_hexpand(true);
area.set_vexpand(true);

gtk_window.remove(vbox);
vbox.remove(&web_view);
overlay.add(&area);
overlay.add_overlay(&web_view);
overlay.set_overlay_pass_through(&web_view, false);
gtk_window.add(&overlay);
```

Render context gets the platform native display:

```rust
Backend::X11     => params.push(RenderParam::X11Display(ptr)),
Backend::Wayland => params.push(RenderParam::WaylandDisplay(ptr)),
```

and the frame loop reads GTK's own FBO id (`glGetIntegerv(GL_FRAMEBUFFER_BINDING)`, `= 0x8CA6`), renders, then **restores GDK's GL state**, with a load-bearing comment:

> "…entry and does NOT restore `glViewport`, `glScissor`, `glBlendFuncSeparate` or `glClearColor` [sic — the text continues to explain GDK relies on them] … GLArea in the same context, so leaving mpv's values behind corrupts every [subsequent GDK draw]"

Operational constraints documented in that file (all load-bearing):
- "WebKit only implements transparent backgrounds inside the accelerated compositor (WebKit bug 192305)", so `WEBKIT_DISABLE_COMPOSITING_MODE` must **not** be set; `HARBOR_LINUX_LEGACY_GFX=1` is the A/B escape hatch that sets it.
- NVIDIA + Wayland ⇒ `__NV_DISABLE_EXPLICIT_SYNC=1` (detected via `/proc/driver/nvidia/version` plus `XDG_SESSION_TYPE`/`WAYLAND_DISPLAY`).
- `apply_rgba_visual()` + `set_app_paintable(true)` are preconditions for transparency; the comment warns GTK3 ignores `set_visual` after realize, so it "is a no-op on an already mapped Tauri window".
- `glGetIntegerv(GL_FRAMEBUFFER_BINDING)` returning 0 means "mpv will render to the default framebuffer and the video region will stay BLACK".
- On Wayland the `GLArea` fills the window via expand flags, so geometry tracking/`resize_to()` is a documented no-op.
- Windows on that branch still uses `wid`.

For context on why the Linux shape is what it is, see Tauri issue #9220 (`https://github.com/tauri-apps/tauri/issues/9220`, closed as not planned), maintainer `amrbashir`: "we are using GTK to create the window… when you add wgpu on top of it, they both fight on the same x11 surface hence the flickering, **we can't really do anything to fix this as we need to use GTK for webviews**… While possible to add a GTK widget as a child X11 window inside raw X11 window, this is however a bit hacky and **it is not possible on Wayland at all**… Can you draw OpenGL into GTK? yes you can combine `gtk::Fixed` a `gtk::GlArea` widget and then add the webview widgets on top of it. The only problem here is that you will do the drawing yourself." That is exactly the slim fork's design.

### 2.2 (b) Frame path

mpv renders **directly into the app-owned FBO** (the `NSOpenGLView`'s / GTK `GLArea`'s framebuffer) in one pass; there is no intermediate texture inside mpv and no app-level copy. Then:
- macOS: the video view sits below the webview in the AppKit view hierarchy; the webview layer is non-opaque, so AppKit composites. Present/vsync: AppKit/CGL, with mpv's render thread waiting per `mpv_render_context_render`.
- Linux: the webview is *a child of the same GTK container*, composited by GDK in the **same GL context** on top of mpv's output. One composition level, but it requires the app to restore GL state exactly, because per `render_gl.h`, "The following state is excluded from this: the glViewport state, the glScissor state …, glBlendFuncSeparate() state …, glClearColor() state, … mpv always disables GL_DITHER at init."

The parked fork's own note in `mpv_render_linux.rs`: "On Wayland, the GLArea fills the full window via GTK expand flags, so geometry tracking is not needed."

### 2.3 (c) Control surface

Full libmpv: these are direct `libmpv2` bindings in the same process. Any property, command, observe, and pre-init option is reachable, including `--script` (set as an option before `mpv_initialize`). What is *not* reachable is any VO choice other than `libmpv`: `vo=libmpv` names the VO registered by `video/out/vo_libmpv.c` (`.description = "render API for libmpv"`), and the render backends it can use are only `render_backend_gpu` (gl_video) and `render_backend_sw` (`video/out/vo_libmpv.c`):

```c
const struct render_backend_fns *render_backends[] = {
    &render_backend_gpu,
    &render_backend_sw,
    NULL
};
```

### 2.4 (d) 4K / HEVC / AV1 evidence

None of the three repos makes a numeric 4K claim for this path. Concretely: harbor's macOS render path sets `hwdec=videotoolbox-copy`; the slim fork's Linux path sets `hwdec=auto-safe`; its Windows path sets `hwdec=d3d11va` when RTX Video is on. `videotoolbox-copy` is copy-back by construction (see §9.2).

### 2.5 (e) Platform coverage

OpenGL render API exists on all platforms mpv supports, but with per-platform context requirements, verbatim from `include/mpv/render_gl.h`: "Windows: **ANGLE is required** (although in theory GL/DX interop could be used) — Intel/Linux: EGL is required, and also the native display resource needs to be provided (e.g. `MPV_RENDER_PARAM_X11_DISPLAY` for X11 and `MPV_RENDER_PARAM_WL_DISPLAY` for Wayland) — nVidia/Linux: Both GLX and EGL should work… — macOS: CGL is required". It adds: "Once these things are setup, hardware decoding can be enabled/disabled at any time by setting the `hwdec` property."

---

## 3. Flutter desktop + `media_kit` / `media_kit_video`

Read from `github.com/media-kit/media-kit` @ `c533e446755f51cf53c7e57aea873f2aa5355f81` (2026-08-30), MIT, 1,842★. Package versions in-tree: `media_kit` 1.2.6, `media_kit_video` 2.0.1.

### 3.1 (a) + (b) Mechanism and frame path

**Windows** — `media_kit_video/windows/angle_surface_manager.cc` + `video_output.cc`. The class header states its own contract:

```cpp
// |ANGLESurfaceManager| provides an abstraction around ANGLE to easily draw
// OpenGL ES 2.0 content & read as D3D 11 texture using shared |HANDLE|.
```

`CreateD3DTexture()` creates **two** textures — "The general idea is to create two textures, one that is used to `Draw` using ANGLE & another one that is used for `Read` the rendered content using `handle`" — both `DXGI_FORMAT_B8G8R8A8_UNORM`, `D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE`, `D3D11_RESOURCE_MISC_SHARED`. EGL is ANGLE with `EGL_PLATFORM_ANGLE_TYPE_D3D11_ANGLE` and a fallback chain (D3D11 → D3D11 9.3 → D3D9 → wrap); the EGL surface is `eglCreatePbufferFromClientBuffer(..., EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE, internal_handle_, ...)` + `eglBindTexImage`.

Per frame:
```cpp
void ANGLESurfaceManager::Draw(std::function<void()> callback) {
  ::WaitForSingleObject(mutex_, INFINITE);
  MakeCurrent(true);
  callback();
  SwapBuffers();          // SwapBuffers() == glFinish()
  MakeCurrent(false);
  ::ReleaseMutex(mutex_);
}
void ANGLESurfaceManager::Read() {
  ...
  d3d_11_device_context_->CopyResource(d3d_11_texture_2D_.Get(), internal_d3d_11_texture_2D_.Get());
  d3d_11_device_context_->Flush();
  ...
}
```
`VideoOutput::Render()` calls `mpv_render_context_render` into FBO **0** inside `Draw(...)`, then `Read()` is invoked from the Flutter GPU-surface callback, then `MarkTextureFrameAvailable`. The Flutter texture is `kFlutterDesktopGpuSurfaceTypeDxgiSharedHandle` with `kFlutterDesktopPixelFormatBGRA8888`.

So the Windows frame path is: mpv → ANGLE GL FBO backed by `internal_d3d_11_texture_2D_` → **`CopyResource` into `d3d_11_texture_2D_` (one GPU copy per frame)** → Flutter engine composites the DXGI shared handle → present. Plus a `glFinish()` per frame. Flutter/D3D11 presents and vsyncs.

**Linux** — `media_kit_video/linux/video_output.cc` + `texture_gl.cc`. This is *not* the `GdkGLContext` shape; the code takes Flutter's EGL display and creates an **isolated, non-shared EGL context**:

```cpp
// Get Flutter's current EGL display (DO NOT share context)
EGLDisplay flutter_display = eglGetCurrentDisplay();
EGLContext flutter_context = eglGetCurrentContext();
...
// Create an isolated EGL context (NOT shared with Flutter)
// This prevents OpenGL state pollution and resource contention
self->egl_context = eglCreateContext(self->egl_display, config, EGL_NO_CONTEXT, context_attribs);
```
(the EGL config is obtained by querying Flutter's `EGL_CONFIG_ID`), and then shares the frame by `EGLImage`:

```cpp
glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, required_width, required_height, 0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
...
self->egl_image = eglCreateImageKHR(egl_display, egl_context, EGL_GL_TEXTURE_2D_KHR, (EGLClientBuffer)(guintptr)self->mpv_texture, egl_image_attribs);
...
glEGLImageTargetTexture2DOES(GL_TEXTURE_2D, self->egl_image);   // in Flutter's context
```

`texture_gl_populate_texture` is the `FlTextureGL` implementation (registered through `FlTextureRegistrar`). Inside it, mpv renders in its own context:

```cpp
mpv_opengl_fbo fbo{(gint32)self->fbo, required_width, required_height, 0};
int flip_y = 0;
int block_for_target_time = 0;
mpv_render_param params[] = {
    {MPV_RENDER_PARAM_OPENGL_FBO, &fbo},
    {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
    {MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block_for_target_time},
    {MPV_RENDER_PARAM_INVALID, NULL},
};
mpv_render_context_render(render_context, params);
```

So Linux is **GPU-shared with no CPU copy and no `CopyResource`** — mpv writes `GL_RGBA8` in its own context, Flutter samples that image in its own context. `BLOCK_FOR_TARGET_TIME = 0`, so Flutter does the timing. Note the asymmetry: **the Linux path is cheaper than the Windows path.**

Two other facts found in code/README:
- **Neither platform sets `MPV_RENDER_PARAM_ADVANCED_CONTROL`** (`grep -rn "ADVANCED_CONTROL\|advanced_control"` over the whole repo → 0 hits). So no direct rendering (`vd-lavc-dr`, which mpv documents as saving "a copy per video frame").
- Windows and Linux both only set `video-sync=audio`; on Windows also `video-timing-offset=0`; on Linux that line is commented out: "Causes frame drops with `pulse` audio output. (SlotSun/dart_simple_live#42)".
- **Software fallbacks**: Windows `MPV_RENDER_API_TYPE_SW` with `rgb0` into a `pixel_buffer_`, clamped to `SW_RENDERING_MAX_WIDTH 1920` / `SW_RENDERING_MAX_HEIGHT 1080`; README: "This means that video is rendered by CPU & every frame is copied back to the RAM… **may not play higher resolution videos properly.**"
- macOS/iOS use `CVPixelBufferCreate` with `kCVPixelBufferMetalCompatibilityKey: true` (`media_kit_video/macos/media_kit_video/Sources/media_kit_video/plugin/gl/OpenGLHelpers.swift`), i.e. a pixel-buffer interop; README: "OpenGL rendering to an OpenGL texture backed by a pixel buffer, which makes it interoperable with METAL (CVPixelBuffer)". README's own "Possible improvements" comment block says: "Render directly to METAL texture… Share the METAL texture between media_kit_video and Flutter, **without using a pixel buffer**."
- Android: `--wid` on `android.view.Surface` + `--hwdec=mediacodec` + `--vo=mediacodec_embed` (README, with the manual link). Web: "**libmpv is not used**. Video & audio playback is handled by embedding HTML `<video>` element."

### 3.2 (c) Control surface — the decisive question

**Arbitrary commands/properties/observers: YES.** `media_kit/lib/src/player/native/player/real.dart` (`NativePlayer extends PlatformPlayer`) defines and `@override`s:

```dart
Future<void> setProperty(String property, String value, {bool waitForInitialization = true})
Future<void> observeProperty(String property, {int? id, Duration timeout = ...})
Future<void> unobserveProperty(...)
Future<void> command(List<String> command, {bool waitForInitialization = true})
```
with the doc: "Sets property for the internal libmpv instance of this `[Player]`. **Please use this method only if you know what you are doing**…". `NativePlayer` **is** exported (`media_kit/lib/media_kit.dart` → `export 'package:media_kit/src/player/native/player/player.dart';` → `export 'real.dart' if (dart.library.js_interop) 'stub.dart';`), and its fields are public:

```dart
/// Generated libmpv C API bindings.
final generated.MPV mpv;
/// [Pointer] to [generated.mpv_handle] of this instance.
Pointer<generated.mpv_handle> ctx = nullptr;
```
so raw C API access is reachable too.

**Pre-init options / mpv scripts: NO through the public API.** `PlayerConfiguration` (`media_kit/lib/src/player/platform_player.dart`) exposes exactly: `vo`, `osc`, `pitch`, `title`, `ready`, `muted`, `async`, `libass`, `libassAndroidFont`, `libassAndroidFontName`, `logLevel`, `bufferSize`, `protocolWhitelist`, `iosManageAudioSession`. `hwdec` lives on `VideoControllerConfiguration` (`media_kit_video/lib/src/video_controller/platform_video_controller.dart`, default `'auto'`). The pre-init option map in `_create()` is **hardcoded**:

```dart
// The options which must be set before [MPV.mpv_initialize].
final options = <String, String>{
  // Set --vid=no by default to prevent redundant video decoding.
  if (!test) 'vid': 'no',
  if (Platform.isIOS && !configuration.iosManageAudioSession)
    'audiounit-skip-session-management': 'yes',
};
...
ctx = await Initializer(mpv).create(_handler, options: options);
```
and `Initializer.create(..., options:)` → `mpv_set_option_string(ctx, ...)` then `mpv_initialize(ctx)` (`media_kit/lib/src/player/native/core/initializer_native_callable.dart`). There is **no exposed path** to pass arbitrary pre-init options. Because mpv's `--script` is a CLI alias that resolves to the pre-init-only `scripts` list — `options/options.c`: `{"scripts", OPT_PATHLIST(script_files), .flags = M_OPT_FILE}, {"script", OPT_CLI_ALIAS("scripts-append")}` — **media_kit's public surface cannot load mpv scripts such as `TOOLS/lua/autocrop.lua`.** `[inference]` the only routes would be forking media_kit, or constructing your own `mpv_create`/`mpv_initialize` alongside it.

**media_kit also overrides mpv's quality/serving defaults after init** (`media_kit_video` and `_create()`), verbatim:

```dart
'scale': 'bilinear',
'dscale': 'bilinear',
'dither': 'no',
'hr-seek-framedrop': 'no',
'correct-downscaling': 'no',
'linear-downscaling': 'no',
'sigmoid-upscaling': 'no',
'hdr-compute-peak': 'no',
...
'cache': 'yes',
'cache-on-disk': 'yes',
...
'sub-ass': configuration.libass ? 'yes' : 'no',
'sub-visibility': configuration.libass ? 'yes' : 'no',
```
i.e. by default media_kit disables dithering, disables all the better scalers, disables HDR peak computation, and **disables libass** (subtitles are then drawn as Flutter widgets, which loses ASS typesetting/positioning) unless `libass: true`.

It observes a fixed set of properties (`pause`, `time-pos`, `duration`, `playlist-playing-pos`, `volume`, `speed`, `core-idle`, `paused-for-cache`, `demuxer-cache-time`, `cache-buffering-state`, `audio-params`, `audio-bitrate`, `audio-device(-list)`, `video-params`, `track-list`, `eof-reached`, `idle-active`, `sub-text`, `secondary-sub-text`) — note `video-params` (which carries dropped-frame/bitrate-ish fields is `video-bitrate`/`frame-drop-count`, which are **not** observed here, but are reachable via `getProperty`).

### 3.3 (d) 4K / HEVC / AV1 evidence

- README goals section: "Handles multiple FHD videos flawlessly. Rendering is GPU-powered (hardware accelerated). **4K / 8K 60 FPS is supported.**"
- Windows section: "The two APIs above are hardware accelerated i.e. GPU backed buffers are used. **This is performant approach, easily capable for rendering 4K 60 FPS videos**, rest depends on the hardware."
- Counter-evidence in the same README: the SW fallback "may not play higher resolution videos properly", and the Windows SW buffer is clamped to 1920×1080 in code.
- No HEVC/AV1-specific claim or benchmark was found; HEVC/AV1 come from FFmpeg/mpv, and on Android `hwdec-codecs` is set to `h264,hevc,mpeg4,mpeg2video,vp8,vp9,av1` (`media_kit_video/lib/src/video_controller/android_video_controller/real.dart`).
- HDR: no HDR path in any of the platform implementations; targets are `BGRA8888` (Windows), `GL_RGBA8` (Linux), `CVPixelBuffer` (macOS), and `hdr-compute-peak=no` is set by default.

### 3.4 (e) Platform coverage

Windows (D3D11/ANGLE; "requires DirectX 11 or higher"), Linux (EGL + `FlTextureGL`; README notes Linux uses system shared libraries: "`sudo apt install libmpv-dev mpv`", "**This is how GNU/Linux works**"), macOS/iOS (CVPixelBuffer), Android (`--wid`/`mediacodec_embed`), Web (`<video>`). Maturity caveats in README: recommends `mimalloc` on Linux "for avoiding memory leaks" (issue #68), and `media_kit_native_event_loop` exists because of Dart FFI callback/deadlock issues.

---

## 4. egui (glow) + `libmpv2` render API

Precedent: **`codeberg.org/sharkyshark/egui-sharkplayer`**, version 0.5.1, **Unlicense**, `Cargo.toml`: `eframe = { version = "0.35", default-features = false, features = ["glow"] }`, `libmpv2 = "6.0"`, optional `khronos-egl`/`loading`/`glow`; features `default = ["wayland", "x11"]`, `wgpu = [...]`.

### 4.1 (a) + (b) Mechanism and frame path

`src/backend.rs` `PlayerState::new`:
```rust
let mpv = Mpv::new()?;
if cfg!(debug_assertions) { mpv.set_property("terminal", "yes")?; }
mpv.set_property("vo", "libmpv")?;
mpv.set_property("hwdec", "auto-safe")?;
// Support HDR video
mpv.set_property("tone-mapping", "auto")?;
mpv.set_property("video-timing-offset", 0.0_f64)?;
// Ensure that completed videos are rewatchable.
mpv.set_property("keep-open", "yes")?;
...
let render_ctx = mpv.create_render_context([
    RenderParam::ApiType(RenderParamApiType::OpenGl),
    RenderParam::InitParams(OpenGLInitParams { get_proc_address: resolve_gl_proc, ctx: Arc::clone(&gpa) }),
])?;
...
render_ctx.set_update_callback(move || { egui_ctx.request_repaint(); });
```

`render_glow` allocates a `GL_RGBA8` texture + FBO (`allocate_framebuffer`), then:
```rust
let flags = self.mpv.ctx.update().unwrap_or(0);
let frame_updated = reallocated || flags & mpv_render_update::Frame != 0;
if frame_updated {
    match res.framebuffer.0.get().try_into() {
        Ok(fb) => self.mpv.ctx.render::<()>(fb, size.width, size.height, true)?,
        ...
```
(`true` = flip_y). The widget then issues a paint callback and **blits** (`src/widget.rs`, `glBlitFramebuffer`, `GL_COLOR_BUFFER_BIT`, `LINEAR`) from mpv's FBO into egui's current framebuffer. So the glow path is: **1 mpv render into an app FBO + 1 blow-up blit**; no CPU copy; present/vsync by eframe/winit. `MpvRenderUpdate` is honoured via `update()`.

The `wgpu` feature is the slow path, documented by the crate itself (`src/lib.rs`): "The video player works best with the `glow` backend because **libmpv2's render API only supports OpenGL**. When using the `wgpu` feature, instead of a direct VRAM copy, image data has to roundtrip through main system memory." The code confirms: `gl.read_pixels(... PixelPackData::Slice(Some(&mut self.wgpu.pixel_buffer)))` → `egui::TextureHandle`; and for the wgpu case it creates a 1×1 pbuffer EGL context purely to give mpv a GL context (`OffscreenEglState`, `khronos_egl::DynamicInstance<EGL1_5>` + `libloading`).

No `ADVANCED_CONTROL` is passed anywhere in this crate.

### 4.2 (c) Control surface, and what `libmpv2` 6.0 actually exposes

From the crates.io tarball `libmpv2-6.0.0` (LGPL-2.1, depends on `libmpv2-sys 4.0.1`):

- `src/mpv/render.rs`:
```rust
pub enum RenderParamApiType {
    OpenGl,
}
```
and `RenderParam` covers `Invalid, ApiType, InitParams, FBO, FlipY, Depth, ICCProfile, AmbientLight, X11Display, WaylandDisplay, AdvancedControl, NextFrameInfo, BlockForTargetTime, SkipRendering`. **No `sw`, no `d3d11`, no Vulkan in the safe wrapper.** The `render`, `update`, `get_info`, `set_update_callback` functions are all generic over `GLContext`.
- `src/mpv.rs` exposes `set_property`, `set_option`, `load_config`, `command`, `get_property`, `create_client`, `get_time_ns/us`, plus `Mpv::new()` (= `with_initializer(|_| Ok(()))`) and `Mpv::with_initializer(|init| ...)`. Its own doc names the pre-init-only options:
  > "The following options can't be set after initialization: 1. options which are only read at initialization time: - config - config-dir - input-conf - load-scripts - **script** - player-operation-mode - input-app-events (OSX) 2. all encoding mode options"
- `src/mpv/events.rs` exposes `observe_property(name, format, id)` / `unobserve_property(id)`, plus the event enum and `wait_event`.

So **`libmpv2` 6.0 does provide the full surface the app needs, including mpv scripts** — via `Mpv::with_initializer(|init| init.set_option("script", "/path/autocrop.lua"))` — and the `render` module is OpenGL-only, as reported. `egui-sharkplayer` itself does not use `with_initializer` (it uses `Mpv::new()` + `set_property`), so *that specific crate* cannot load scripts as shipped.

Exposed getters in sharkplayer show what it considers reachable stats: `colormatrix`, `container-fps`, `current-demuxer`, `file-format`, `filename`, **`hwdec-current`**, `media_title`, `mute`, `video-codec`, `video-format`, `volume`, `pause`, `duration`, plus direct `get_optional_property` for `time-pos`, **`frame-drop-count`** (`frame_drop_count()`), `video-out-params/dw|dh`, and `command("loadfile"|"seek", ...)`. i.e. dropped frames and hwdec *are* reachable; bitrate requires adding a getter.

### 4.3 (d) 4K / HEVC / AV1 evidence

**None found in the crate.** docs.rs reports 318 downloads and 20.59% documented (per the crate's own metrics page), and the README is four lines pointing at docs.rs. No benchmark, no resolution/fps claim, no HDR claim. `tone-mapping="auto"` with the comment "Support HDR video" is the only HDR-related line, and the target FBO is `GL_RGBA8` (8-bit), so HDR passthrough is not possible on this path.

### 4.4 (e) Platform coverage

`eframe`/`glow` = OpenGL on Windows/Linux/macOS; the crate's default cargo features are `wayland` and `x11`. It is the *mechanism*, not the *app UI*, that must run on all three; the crate itself has no platform-specific glue code (`src/archive` absent; only `backend.rs`, `backend/wgpu_backend.rs`, `widget.rs`).

---

## 5. Qt6/QML + libmpv render API into `QQuickFramebufferObject`

### 5.1 (a) Mechanism — three independent instances of the same pattern

**mpv's own example, `mpv-player/mpv-examples/libmpv/qml`** (`main.cpp`; the examples live in `mpv-examples`, not in the mpv source tree — `find /tmp/opencode/mpv-master -iname '*.qml'` is empty):
```cpp
class MpvRenderer : public QQuickFramebufferObject::Renderer {
    QOpenGLFramebufferObject * createFramebufferObject(const QSize &size) {
        if (!obj->mpv_gl) {
            mpv_opengl_init_params gl_init_params[1] = {get_proc_address_mpv, nullptr};
            mpv_render_param params[]{
                {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
                {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params},
                {MPV_RENDER_PARAM_INVALID, nullptr}
            };
            mpv_render_context_create(&obj->mpv_gl, obj->mpv, params);
            mpv_render_context_set_update_callback(obj->mpv_gl, on_mpv_redraw, obj);
        }
        return QQuickFramebufferObject::Renderer::createFramebufferObject(size);
    }
    void render() {
        obj->window()->resetOpenGLState();
        QOpenGLFramebufferObject *fbo = framebufferObject();
        mpv_opengl_fbo mpfbo{.fbo = static_cast<int>(fbo->handle()), .w = fbo->width(), .h = fbo->height(), .internal_format = 0};
        int flip_y{0};
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &mpfbo},
            {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
            {MPV_RENDER_PARAM_INVALID, nullptr}
        };
        mpv_render_context_render(obj->mpv_gl, params);
        obj->window()->resetOpenGLState();
    }
};
```
plus `mpv_set_option_string(mpv, "vo", "libmpv")`, `hwdec=auto`, `window()->setPersistentOpenGLContext(true); window()->setPersistentSceneGraph(true);`, and the documented locale gotcha: "Qt sets the locale in the QGuiApplication constructor, but libmpv requires the LC_NUMERIC category to be set to 'C', so change it back". Its `main.qml` is the proof-of-concept for "**QtQuick and mpv are both rendering stuff**" with QML overlays (`MouseArea`, `Rectangle`, `Row`, `Slider`) drawn over the `MpvObject`.

**Stremio `stremio-shell`** (`github.com/Stremio/stremio-shell`, GPL-3.0, 928★, pushed 2026-03-27) — **Qt 5**, C++11 (`CMakeLists.txt`: `set(QT_DEFAULT_MAJOR_VERSION 5)`, `set(CMAKE_CXX_STANDARD 11)`), `mpv.cpp` is the same `MpvRenderer : QQuickFramebufferObject::Renderer` pattern with `mpv::qt::set_property(mpv, "vo", "libmpv")`, `gpu-hwdec-interop=auto`, `DwmEnableMMCSS(TRUE)` on Windows, and an event bridge forwarding `mpv-prop-change`/`mpv-event-ended` to the QML/web layer. Crucially, `main.cpp` on Windows:
```cpp
// Default to ANGLE (DirectX), because that seems to eliminate so many issues on Windows
// Also, according to the docs here: https://wiki.qt.io/Qt_5_on_Windows_ANGLE_and_OpenGL, ANGLE is also preferrable
Application::setAttribute(Qt::AA_UseOpenGLES);
```
That is precisely the configuration shell-ng's README blames.

**KDE `mpvqt`** (`https://invent.kde.org/libraries/mpvqt`, SPDX `LGPL-2.1-only OR LGPL-3.0-only OR LicenseRef-KDE-Accepted-LGPL`) — the library mpv's README points to and the one **Jellyfin** uses. `src/mpvrenderer.cpp` is the same pattern with native-display params:
```cpp
mpv_render_param display{MPV_RENDER_PARAM_INVALID, nullptr};
#if defined(Q_OS_UNIX) && !defined(Q_OS_DARWIN) && ...
    if (QGuiApplication::platformName() == QStringLiteral("xcb")) {
        display.type = MPV_RENDER_PARAM_X11_DISPLAY;
        display.data = qGuiApp->nativeInterface<QNativeInterface::QX11Application>()->display();
    }
    if (QGuiApplication::platformName() == QStringLiteral("wayland")) {
        display.type = MPV_RENDER_PARAM_WL_DISPLAY;
        display.data = qGuiApp->nativeInterface<QNativeInterface::QWaylandApplication>()->display();
    }
#endif
```
and it takes **one hard requirement**, in `src/mpvabstractitem.cpp`:
```cpp
if (QQuickWindow::graphicsApi() != QSGRendererInterface::OpenGL) {
    qCCritical(MpvQt_MpvAbstractItem) << "The graphics api must be set to opengl "
                                         "or mpv won't be able to render the video.\n"
                                         "QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL)\n"
                                         "The call to the function must happen before constructing "
                                         "the first QQuickWindow in the application.";
}
```
`MpvAbstractItem` lives on a worker `QThread` (`mpvController->moveToThread(m_workerThread)`) and exposes to QML: `observeProperty`, `unobserveProperty`, `setProperty`, `setPropertyAsync`, `setPropertyBlocking`, `getProperty`, `getPropertyAsync`, `command`, `commandBlocking`, `commandAsync`, `expandText`. The frame is rendered with `flip_y = 0` and no `BLOCK_FOR_TARGET_TIME`/`ADVANCED_CONTROL` parameter. `mpvqt` also loads its own config file (`README.md`): "`MpvQt` loads a config file located at `<config_folder>/mpvqt/mpvqt.conf`, the file has to be manually created and is a regular mpv config file. The settings apply to all applications using MpvQt, applications can override the properties set in MpvQt's config file."

### 5.2 (b) Frame path

mpv renders into the FBO that Qt Quick's `QQuickFramebufferObject` owns; the scene graph then draws that FBO as a texture into Qt's own render pass. Copies/blits: none added by mpv; the FBO is sampled by the scene-graph renderer (which is where the "multiple levels of composing and drawing to textures" that shell-ng complains about comes from — Qt's scene graph render pass, the extra render target, and a possible texture step). Present/vsync: Qt (`QQuickWindow`, threaded render loop on Windows/GL/Vulkan). `resetOpenGLState()` is called on both sides of `mpv_render_context_render`, which is the Qt-idiomatic way of dealing with the state mpv documents as excluded (`glViewport`, `glScissor`, `glBlendFuncSeparate`, `glClearColor`).

### 5.3 (c) Control surface

Full mpv, at the Qt-wrapper level: `command*`, `setProperty*`, `getProperty*`, `observeProperty`, `expandText`, and (where the app holds the `mpv_handle`, as Jellyfin does) arbitrary `mpv_*` calls and pre-init options, hence `--script` and arbitrary options before `mpv_initialize`. mpv's own README for the examples states the advantage over `wid`: "Since it does not rely on embedding 'foreign' native Windows, it's usually more robust, potentially faster, and it's easier to control how your GUI interacts with the video. **You can do your own OpenGL rendering on top of the video as well.**" (that quote is from `libmpv/qt_opengl`; `libmpv/qml` is the QML variant).

What is not reachable: any VO but `libmpv`; and via the render API, **no libplacebo** (§9.2).

### 5.4 (d) 4K / HEVC / AV1 evidence

- No numeric 4K/HEVC/AV1 claim found in any of the three repos.
- The one quantified claim found is shell-ng's README, which is a *counter*-claim: "about 2-5x more efficient… because… Qt having a complex rendering pipeline involving ANGLE and multiple levels of composing and drawing to textures, which inhibits full HW acceleration." (Note carefully: that statement is about Qt **5** + ANGLE on Windows.)
- Qt 6 evidence in Jellyfin: `src/main.cpp`:
```cpp
detectOpenGLEarly();
QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL);
QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);
```
and `src/player/OpenGLDetect.cpp`:
```cpp
void detectOpenGLLate()
{
  // Qt 6 does not support AA_UseOpenGLES - it uses desktop OpenGL by default
  // No need to force GLES version, let Qt use the native OpenGL
  qInfo() << "Using native desktop OpenGL (Qt 6)";
}
```
So on Qt 6 Jellyfin runs desktop OpenGL, not ANGLE. `[inference]` on Windows with desktop WGL + the render API, mpv has no ANGLE/DX-GL interop, so `d3d11va` zero-copy is unavailable and hwdec falls back to copy-back (see §9.2); the app exposes exactly that as a setting ("copy" → `hwdec=auto-copy`).

### 5.5 (e) Platform coverage, and the Qt 6 RHI constraint

Authoritative, from Qt 6 documentation for `QQuickFramebufferObject` (`https://doc.qt.io/qt-6/qquickframebufferobject.html`, fetched 2026-10-15):

> "**Warning:** This class is only functional when Qt Quick is rendering via OpenGL. It is not compatible with other graphics APIs, such as Vulkan or Metal. **It should be treated as a legacy class that is only present in order to enable Qt 5 applications to function without source compatibility breaks as long as they tie themselves to OpenGL.**"

and from Qt Quick's Scene Graph page (`https://doc.qt.io/qt-6/qtquick-visualcanvas-scenegraph.html`):

> "The threaded renderer is currently used by default on **Windows with Direct3D 11** and with OpenGL when using opengl32.dll, Linux excluding Mesa llvmpipe, **macOS with Metal**, mobile platforms, and Embedded Linux with EGLFS, and with **Vulkan regardless of the platform**."

So on Qt 6 the same class of problem shell-ng described re-appears in a different form: the RHI default is not OpenGL, and the render API path **requires forcing** the OpenGL backend (as `mpvqt` asserts at runtime and Jellyfin does at startup). The Scene Graph page also documents the three sanctioned custom-rendering routes and that the texture-based route "involves an additional render pass and render target", confirming an extra composition step relative to a native child window.

---

## 6. Compose Multiplatform (JVM desktop) + mpv — `coveninja/cove`

Repo: `https://github.com/coveninja/cove`, **AGPL-3.0**, Kotlin, 150★, `VERSION` = `1.6.0`, pushed 2026-10-09, created 2025.

### 6.1 (a) Exact mechanism — desktop

From `ARCHITECTURE.md`: "Desktop mpv stays in-process through JNA. **The OpenGL path retains GPU rendering and hardware decoding**; software rendering remains the controlled fallback." From `docs/APP.md`: "`:ui` is multiplatform and cannot see libmpv directly, so **desktop provides its JNA/OpenGL host** and Android provides its native surface host."

`app/desktop/src/main/kotlin/com/coveninja/cove/desktop/player/Mpv.kt` declares its own JNA `MpvLibrary` and loads `mpv-2` (Windows) or `mpv` (Linux/macOS) via `Native.load(...)`, with explicit search paths (`COVE_MPV_LIBRARY_DIR`, Homebrew prefixes on macOS), and — a data point worth quoting, because it is a libmpv-on-JVM gotcha:

```kotlin
/**
 * LC_NUMERIC must be "C" before mpv_create — AWT sets the process-wide C
 * locale from the user's system locale, and mpv then misparses every float
 * option (e.g. volume=100.0 silently breaks on Turkish or German locales).
 */
@Synchronized
fun create(): Pointer? {
    NativeNumericLocale.forceC()
    return library().mpv_create()
}
```

`MpvOpenGlPlayer.start()` sets options **before `mpv_initialize`** (that is `setOption`, i.e. `mpv_set_option_string`), then initializes:
```kotlin
setOption(library, created, "vo",        "libmpv")
setOption(library, created, "terminal",  "no")
setOption(library, created, "msg-level", "all=warn")
setOption(library, created, "keep-open", "yes")
setOption(library, created, "volume-max", MAX_VOLUME.toInt().toString())
setOption(library, created, "ytdl", "yes")
setOption(library, created, "hwdec",     "auto-safe")
checkMpv(library, library.mpv_initialize(created), "initialize")
```
and creates the render context with **advanced control on** and the X11 display on Linux:
```kotlin
val adv = Memory(Int.SIZE_BYTES.toLong()).apply { setInt(0, 1) }
val paramCount = if (nativeX11Display == null) 4 else 5
params[0].type = Mpv.RENDER_PARAM_API_TYPE;           params[0].data = api            // "opengl"
params[1].type = Mpv.RENDER_PARAM_OPENGL_INIT_PARAMS; params[1].data = init.pointer
params[2].type = Mpv.RENDER_PARAM_ADVANCED_CONTROL;   params[2].data = adv
if (nativeX11Display != null) { params[3].type = Mpv.RENDER_PARAM_X11_DISPLAY; params[3].data = nativeX11Display }
```

The GL surface is **JOGL `GLJPanel`** (`MpvOpenGlPanel.kt`), whose own class comment explains the choice and the cost:

```kotlin
/**
 * Lightweight Swing OpenGL surface for libmpv.
 *
 * GLJPanel renders into an offscreen hardware FBO and then composites as
 * ordinary Swing pixels, so it clips and z-orders correctly inside Compose
 * Desktop's SwingPanel. GLCanvas is a heavyweight peer and would float above
 * everything — never use it here.
 */
```
and the two GL-integration fixes it documents:
```kotlin
// mpv's FBO is already correctly oriented. Skipping GLJPanel's GLSL
// vertical flip avoids a second state-sensitive pass ...
setSkipGLOrientationVerticalFlip(true)
...
// mpv_render_context_render() returns with framebuffer 0 bound.
// GLJPanel's readback/composition pass expects its own offscreen
// FBO still bound when this listener exits — rebind it.
drawable.gl.glBindFramebuffer(GL.GL_FRAMEBUFFER, fbo[0])
```
The FBO id passed to mpv comes from `glGetIntegerv(GL_FRAMEBUFFER_BINDING)` inside `display()`. The render path is:
```kotlin
library.mpv_render_context_update(ctx)
...
library.mpv_render_context_render(ctx, params[0].pointer)   // FBO = JOGL's offscreen FBO
```
Compose hosting (`app/desktop/.../Main.kt`): "OpenGL render surface: JOGL GLJPanel composited via SwingPanel", using `androidx.compose.ui.awt.SwingPanel(modifier = Modifier.fillMaxSize(), factory = { panel })`. And Compose can only draw *over* it with interop blending enabled — `PlayerLayer.kt`:

> "On desktop the video arrives through a SwingPanel, and Compose only draws over an interop surface when `compose.interop.blending` is enabled — see the property set in the desktop entry point. Without it the controls below are invisible even though they are composed."

**Software fallback** (`MpvSoftwarePlayer.kt`): `MPV_RENDER_API_TYPE_SW` with `RENDER_PARAM_SW_SIZE/FORMAT("rgb0")/STRIDE/POINTER`, `vo=libmpv`, and `hwdec` explicitly `"auto-copy"` when hardware decoding is on (vs `"no"` when off), i.e. copy-back on the SW path. It also sets `ytdl=yes`, `script-opts=ytdl_hook-ytdl_path=...`, `ytdl-format`, `ytdl-raw-options`, `stream-lavf-o` reconnect flags, cache sizes, `network-timeout=90`.

**Android** (same product, different mechanism): `dev.jdtech.mpv.MPVLib` (a Kotlin/JNI wrapper over mpv-android's native libmpv), `requireMpv().attachSurface(surface)` on `onSurfaceCreated`, plus `setInitialOption(...)` before init:
```kotlin
setInitialOption("vo", "gpu")
setInitialOption("gpu-context", "android")
setInitialOption("gpu-dumb-mode", "yes")
setInitialOption("hwdec", "mediacodec")
setInitialOption("hwdec-codecs", "h264,hevc,vp8,vp9,av1")
...
setInitialOption("config", "yes")
```
with a bundled config directory under `appContext.filesDir/mpv` — i.e. `--wid`-equivalent Surface embedding + config-file loading (the comment says "this host does load one (`config=yes` below)").

### 6.2 (b) Frame path

Desktop: mpv renders into JOGL's offscreen FBO → `GLJPanel` composites it "as ordinary Swing pixels" into the AWT component → Compose/Skiko composites the window. `[inference]` that is at least one composition step more than a native child window, and the panel's own comment ties it to a readback/composition pass; I could not measure whether JOGL's `GLJPanel` uses a texture blit or a `glReadPixels`-style readback in this app's configuration (see §10). vsync/present: AWT/JOGL + the compositor; `ADVANCED_CONTROL=1` means mpv's render thread may block waiting for the app (and the app owns the swap by calling `mpv_render_context_update`/`render`).

Android: mpv renders into the `Surface` (`vo=gpu`, `gpu-context=android`), SurfaceFlinger composites. `gpu-dumb-mode=yes` is set.

### 6.3 (c) Control surface

Effectively the whole surface, since it is raw libmpv through JNA:
- Pre-init options: yes — `setOption(...)` before `mpv_initialize` (they set `script-opts` this way for `ytdl_hook`). So `--script=<path>` is reachable in principle; the code does not currently set `script` (grep for a `script` option/setting returns only `script-opts`).
- Commands/properties: `command(...)`, `mpv_set_property(...)`, `getDouble/getFlag/getString(...)`, `mpv_observe_property`? *(their Android host uses `observeProperty(it, format)` from MPVLib; the desktop OpenGL host polls on a 200 ms timer instead of observing — `pollState`)*.
- Crop/aspect: `setScaling(keepAspect, panscan, zoom)` → `command("set","keepaspect", ...)`, `"panscan"`, `"video-zoom"`.
- Subtitles: `addSubtitle(url, title, language, select)` → `command("sub-add", url, "auto"|"select", title, language)`; track selection via `command("set","sid"/"aid", ...)`.
- Stats: `frame-drop-count`, `decoder-frame-drop-count`, `video-bitrate`, `hwdec-current`, `track-list`, `media-title`, `video-codec` are polled and surfaced (`PlayerStatsOverlay` shows "Output drops" / "Decoder drops").
- mpv.conf: the backend ships a settings API (`GET/PUT /settings/mpv-conf`, `DeviceSettingsService` writes `<dataDir>/mpv/mpv.conf`) and the Android host loads configs (`config=yes`). I found **no** `mpv_load_config_file`/`config-dir` call in the desktop player, so whether desktop loads that file is unverified (§10).

### 6.4 (d) 4K / HEVC / AV1 evidence

No numeric 4K/fps claim found in `README.md`, `ARCHITECTURE.md`, `docs/APP.md` or the install guides (grep for `4k|2160|hdr|hevc|av1` over the docs returns nothing). The Android host advertises `hwdec-codecs=h264,hevc,vp8,vp9,av1`. `docs/TESTING.md` lists a "Live mpv smoke on the affected OS/GPU path" test but no resolution target.

### 6.5 (e) Platform coverage

Desktop: Linux (AUR/tarball builds require distro `libmpv`; Flatpak), Windows (bundles the mpv DLL), macOS ("bundles libmpv and its native runtime dependencies", Apple-silicon DMG, `docs/UPDATES.md` says `package-macos` "ad-hoc signs the bundled libmpv"). Android phones/tablets/TV. The shared Kotlin/JVM core is common; only the player host differs. Note the honest framing in `ARCHITECTURE.md`: "The shared UI sees both through the same `VideoPlayerHost` and `PlaybackRepository` contracts without pretending the native binaries or surface lifecycles are interchangeable."

---

## 7. Quick yes/no for the remaining stacks

### 7.1 Avalonia / .NET — **yes, real precedents exist**

| Project | License | ★ | Last push | Mechanism (verified from README / tree) |
|---|---|---|---|---|
| `SaverinOnRails/Mpv.Avalonia` | none declared (GitHub API `license: null`) | 27 | 2025-09-21 | "Media Player for Avalonia based on MPV + OpenGL." README: "**Does not use NativeControlHost, draws with OpenGl instead so more flexible. Works in both Windows and usercontrols with ease and can be drawn over.**" `src/AvaloniaMpv/Client.cs` contains `mpv_render_context_create`. |
| `Naylor55/AvaloniaMpv` | Apache-2.0 | 13 | 2024-03-22 | Cross-platform RTSP player; README documents loading `libmpv-2.dll` / `libmpv.so.1` / `libmpv.dylib` per OS and instantiating **16** `VideoView` controls at once; wrapper generated from `homov/LibMpv`. `LibMpv.Client/libmpv.cs` has `mpv_render_context_create`. |
| `parintorn0/LibMpv.Avalonia` | MIT | 0 | 2026-05-05 | Avalonia + `LibMpv` interop (`LibMpv/Native/MpvNative.cs` with `mpv_render_context_create`). |

No 4K/HEVC/AV1/HDR claim was found in any of the three.

### 7.2 Slint (Rust) — **yes, one example**

`maurges/slint-mpv-widget` (no license file, 3★, last push 2024-02-11): "Not a complete widget, but it's an example of drawing mpv video into slint texture." Same `QQuickFramebufferObject`-shaped problem, in Slint's terms: "It would be better if slint opengl also created a context for you with a framebuffer shared, like in qt. **It took me a long time to figure out how to make it so mpv wouldn't fuck up slint's drawing context**, and I'm still not sure why it works here but not in my similar c++ project." Also: "Performance is great even in debug mode, unsurprisingly." No 4K claim. Its `src/mpv.rs` is a hand-rolled `mpv_create`/set-options/`initialize` binding.

### 7.3 Iced (Rust) — **yes, one crate, and it documents the cost**

`ophymx/iced_mpv` (**Apache-2.0**, 1★, pushed 2026-09-06): "An iced widget that embeds libmpv for video playback. Pre-release (v0.1, Linux only)." Its README's feature table:
- default: "mpv → **CPU RGBA buffer** → `iced::advanced::image::Handle`. No GPU interop deps."
- `gpu`: "mpv → GL FBO → **GL→Vulkan blit** → Vulkan-backed `wgpu::Texture` → iced shader widget. Falls back to SW if init fails."

Platform support table, verbatim: Linux ✅/✅ "(mpv GL → OPAQUE_FD → Vulkan/wgpu)"; macOS "untested / planned via IOSurface"; Windows "untested / planned via D3D11/D3D12 shared handle". On 4K: "the iced render thread is the dominant CPU cost **at 2160p (≈90% of one core** in our benches — and `comparisons/` shows the GStreamer-based `iced_video_player` pays the identical cost, so this is an iced ceiling, not a decode-path issue)". On HDR: "**Surface color-space / HDR configuration.** wgpu 30 added `SurfaceConfiguration::color_space`… iced doesn't expose it… This — not wgpu, not mpv — is what gates HDR output for any iced video widget." It also names the missing primitive: "First-class foreign-texture widget (iced-rs/iced#1237)… We currently route through `shader::Program` + `Primitive::prepare`."

### 7.4 Electron — **yes, two shapes; the historically popular one is dead**

- **Pepper/PPAPI (dead):** `Kagami/mpv.js` (CC0-1.0, 446★, last push 2024-01-17) — "All format embeddable player for Electron/NW.js applications", "mpv pepper plugin". Usage requires `app.commandLine.appendSwitch("register-pepper-plugins", getPluginEntry(pluginDir))` and `new BrowserWindow({ webPreferences: { plugins: true } })`. Chromium `main` no longer contains the implementation: `https://raw.githubusercontent.com/chromium/chromium/main/ppapi/` and `.../content/renderer/pepper` both return **HTTP 404** (checked 2026-10-15), and `content/public/common/content_switches.cc` no longer defines `register-pepper-plugins` (it still mentions "the non-PPAPI PDF plugin"). `[inference]` that is why mpv.js has not moved since 2024.
- **`--wid` + JSON IPC (live):** `icebang01/lumora` — Electron 33, Windows-only, license field `NOASSERTION` (README badge says "UNLICENSED"), 0★, pushed 2026-08-17. `src/main/mpv-backend.js` header: "MPV 后端 —— 通过 `--wid` 将 mpv 嵌入 Electron 窗口，用 JSON IPC 遥控"; it spawns `mpv.exe` with `--wid=${wid}` built from `getNativeWindowHandle()`, `--input-ipc-server=...`, tries `--gpu-api=d3d11` → gpu-auto → `--gpu-api=opengl` → `--vo=null` fallback, and sets `--hwdec=auto-safe`. Also `Newish0/mpv-electron` (GPL-2.0, 1★, 2024): koffi FFI bindings to `mpv_create`/`mpv_set_option`/`mpv_initialize`/`mpv_command`, with the working example commented as `mpv_set_option(handle, "wid", 4, koffi.as([1312954], "int64_t *"))`. And `j-holub/Node-MPV` (130★) is spawn + IPC with **no** video embedding.
- No 4K claim verified in any Electron case; lumora's README advertises "硬解 HDR 与 ICC 色彩管理" (hardware decode, HDR and ICC colour management) but that is an unverified self-description from a 0★, unlicensed, Windows-only project.

### 7.5 .NET MAUI — **no real libmpv integration found for the MAUI UI layer**

- Nearest MAUI data point: `kankejiang/CatClawVideo` (MIT, 19★, pushed 2026-10-15), "猫爪影视 — a modern cross-platform video player built with .NET MAUI". Its README's feature list says the dual-platform players are "Android 使用 Media3 ExoPlayer（含 HLS），Windows 使用 WinUI MediaPlayer" — i.e. **not mpv** — while its tree does contain `CatClawVideo.Maui/Platforms/Windows/Mpv/MpvLib.cs` (a Windows-only P/Invoke file with `mpv_render_context_create`). Platforms present: `Android`, `Windows`. No cross-platform libmpv mechanism.
- The relevant layer on Windows for MAUI is WinUI 3, and the precedent there is `Richasy/mpv-winui` (MIT, 11★, pushed 2025-05-25), whose README states the mechanism and its cost: "This is a test project primarily aimed at integrating libmpv into WinUI3. After some modifications, **libmpv uses OpenGL to render content, while XAML only supports DirectX content. Therefore, the core task is to convert the OpenGL content into DirectX content required by XAML through a swapchain.**" (It says the core is used in `Richasy/Bili.Copilot`.) No 4K claim.

---

## 8. Jellyfin Media Player — verified player stack

**Identity:** `github.com/jellyfin/jellyfin-media-player` currently resolves to **`jellyfin/jellyfin-desktop`** (renamed; the local clone's `origin` is the old URL). GitHub API: `GPL-2.0`, 5,871★, pushed 2026-08-31, primary language C++, `VERSION` = `2.0.0-dev`.

**Stack (verified):** README line 1: "Jellyfin desktop client built with **Qt WebEngine and [libmpv](https://github.com/mpv-player/mpv)**. Supports audio passthrough, hardware decoding, and playback of more formats without transcoding." **Qt 6** (`CMakeLists.txt` uses `Qt6_POSITION_INDEPENDENT_CODE`), QML front end (`src/ui/webview.qml` imports `Konvergo 1.0`, `QtWebEngine`, `QtWebChannel`).

**Rendering mechanism:** not hand-rolled — it consumes KDE's `MpvQt`, pulled as a git submodule (`.gitmodules`): `[submodule "external/mpvqt"] path = external/mpvqt  url = https://invent.kde.org/libraries/mpvqt.git`. `CMakeModules/DependencyConfiguration.cmake` does `find_package(MpvQt REQUIRED)`; `CMakeLists.txt` has `option(USE_STATIC_MPVQT "Build MpvQt from bundled submodule instead of using system library" OFF)`.

- `src/player/MpvVideoItem.h/.cpp`: `class MpvVideoItem : public MpvAbstractItem`, and the constructor emits `setProperty("vo", "libmpv")`; on Windows it **also** forces `gpu-api=opengl` and `opengl-es=no`.
- `src/ui/webview.qml`: `MpvVideoItem { id: video; objectName: "video"; anchors... }` then `WebEngineView { ... z: 100 }` — the web UI is composited **above** the video item, same window, same scene graph.
- Startup: `src/main.cpp` calls `detectOpenGLEarly();` then `QQuickWindow::setGraphicsApi(QSGRendererInterface::OpenGL); QCoreApplication::setAttribute(Qt::AA_ShareOpenGLContexts);` — the OpenGL RHI requirement from `mpvqt`/Qt 6.
- `src/player/PlayerComponent.cpp`: keeps its own `mpv_observe_property` set (`pause`, `core-idle`, `cache-buffering-state`, `playback-time`, **`vo-configured`**, `duration`, `audio-device-list`, `video-dec-params`, `demuxer-cache-state`); uses `mpv_hook_add(..., "on_load"/"on_preloaded")` (with a `MPV_CLIENT_API_VERSION < MPV_MAKE_VERSION(1,100)` fallback to the `hook-add` command); sets `hwdec` by policy:
```cpp
QString hwdecMode = "no";
if (hardwareDecodingMode == "enabled") hwdecMode = "auto";
else if (hardwareDecodingMode == "osx_compat") { hwdecMode = "auto"; hwdecVTFormat = "uyvy422"; }
else if (hardwareDecodingMode == "copy") hwdecMode = "auto-copy";
m_mpv->setProperty("hwdec", hwdecMode);
m_mpv->setProperty("hwdec-image-format", hwdecVTFormat);
```
and logs `hwdec-current`/`hwdec-interop`, `vo-drop-frame-count`, `vo-delayed-frame-count`, `frame-drop-count` in its info panel. **No `hdr`/`tone-mapping`/`target-colorspace` option appears anywhere in `PlayerComponent.cpp`** (grep) — so this widely used data point does **not** configure HDR passthrough.
- Linux GL/EGL selection is a real mpv trick: `src/player/OpenGLDetect.cpp::probeHwdecInterop()` creates a throwaway mpv instance, sets `gpu-hwdec-interop=auto`, `force-window=true`, `geometry=1x1+0+0`, `border=false`, initializes it and reads back `hwdec-interop`; if it returns `vaapi-egl` the app sets `QT_XCB_GL_INTEGRATION=xcb_egl`. Its comment: "Attempt to reuse mpv's code for detecting whether we want GLX or EGL (which is tricky to do because of hardware decoding concerns). This is not nice, but quite effective… **Actually creating a window is required. There is currently no way to keep this window hidden or invisible.**"
- Config: README documents per-profile config dirs and "You can also add `mpv.conf` to configure MPV directly"; `mpvqt` additionally reads `<config_folder>/mpvqt/mpvqt.conf` with app-level property overrides.
- Mechanism/platform coverage = mpvqt's: render API into `QQuickFramebufferObject`, forcing the OpenGL RHI, on Windows/Linux/macOS (plus RPI: `TARGET_RPI` switches `vo` to `"rpi"` and calls `window->setFlags(Qt::FramelessWindowHint)`, and adds RPI-specific low-memory settings).

---

## 9. What each mechanism loses relative to running plain `mpv`

### 9.1 `--wid` embedding (stacks 1, and the Android path of 3 and 6)

**Inside mpv's own pipeline: nothing.** mpv owns the window, picks its VO (`gpu-next`/`gpu`), owns the swapchain, presents, and applies its own `video-sync`/vsync. This is the structural reason a `wid` design can reach "full HW acceleration" and `d3d11`/`gpu-next` features. Costs are *at the seams*:

- **Platform restriction.** The manual (`--wid=<ID|-1>`) enumerates X11, win32 and Android only. macOS: no Cocoa `wid` (ventic README: "mpv's Cocoa output takes no `--wid` — the manual offers it for X11, win32 and Android only"). Wayland: none at all, so a Linux app must force X11/XWayland (`GDK_BACKEND=x11` in ventic; Tauri #11944 `Abab-bk`: "this is an unsolvable problem on Linux" in the Steam-Overlay/Wayland context).
- **`--wid` overrides window geometry.** Manual: "If an external window is specified using the `--wid` option, this option is ignored" (the `--geometry` entry).
- **Input is not automatic.** On win32 mpv itself disables the embedded window (ventic's code comment: `EnableWindow(w32->window, 0)`, unconditional for every `--wid` embed), and on all platforms the app must keep the video's hit region correct — hence Harbor's `WS_EX_TRANSPARENT`+`WM_NCHITTEST`/`HTTRANSPARENT` and Ventic's X Shape / `SetWindowRgn` cut-outs. If you get it wrong, either the web UI stops receiving input or the DOM controls disappear behind the video.
- **Composition is the OS's job.** Whatever the webview paints cannot be interleaved with the video in a single render pass; the app's options are "video above, webview see-through or cut away" or "webview above, video click-through". Tauri cannot put a GTK-webview above a native GPU child on X11 without fighting over the same X surface (tauri #9220).
- **Transparency is coarse.** For WebView2: "translucent colors are not supported" and any alpha other than 0/255 becomes 255 (Microsoft / Tauri docs, §1.1). For WebKitGTK: transparency needs the accelerated compositor (WebKit bug 192305) and an RGBA visual + `set_app_paintable(true)`.

### 9.2 The libmpv render API (stacks 2, 3, 4, 5, 6, 8)

**This is where the real losses are.** Verified against mpv `master`:

1. **`vo` is forced to `libmpv`.** `video/out/vo_libmpv.c` registers `video_out_libmpv` with `.name = "libmpv"`, `.description = "render API for libmpv"`. `DOCS/client-api-changes.rst` 2.3 (mpv 0.38.0): "remove libmpv as the default VO and move it to the bottom of the auto-probing order."
2. **No libplacebo / `gpu-next`.** The render API selects from exactly two backends:
   ```c
   const struct render_backend_fns *render_backends[] = { &render_backend_gpu, &render_backend_sw, NULL };
   ```
   and `render_backend_gpu` is `gl_video` (`video/out/gpu/libmpv_gpu.c`; `struct priv { struct gl_video *renderer; ... }`; its `context_backends[]` are `libmpv_gpu_context_d3d11` and `libmpv_gpu_context_gl`). **There is no gpu-next/libplacebo render backend anywhere in the tree.** Consequences that are individually documented:
   - `--gpu-next`-only hwdecs are unavailable: manual, "`vulkan`: requires `--vo=gpu-next` (Any platform with Vulkan Video Decoding)".
   - **HDR passthrough is unavailable.** Manual, `--target-colorspace-hint=<auto|yes|no>`: "When enabled, output colorspace metadata will be set **on the swapchain** depending on the GPU context and platform… **Currently, this is supported on Wayland, D3D11 and winvk contexts.** … Requires a supporting driver and **`--vo=gpu-next`**." With the render API the app owns the surface and mpv has no swapchain, so this stage is the app's to implement; and on the OpenGL/ANGLE contexts the feature is not supported anyway. The render API's HDR-related params are only advisory: `MPV_RENDER_PARAM_ICC_PROFILE` and the now-deprecated `MPV_RENDER_PARAM_AMBIENT_LIGHT`.
   - D3D11-specific output options (`--d3d11-output-csp`, `--d3d11-output-format`, `--target-trc`, `--target-prim`) are d3d11-*context* options — the `wid` designs set them (shell-ng), the render-API designs cannot.
3. **No `--gpu-context`/`--gpu-api` choice.** You hand mpv a context instead. Platform requirements, verbatim from `render_gl.h`: "Windows: **ANGLE is required** (although in theory GL/DX interop could be used)"; Linux needs EGL + `MPV_RENDER_PARAM_X11_DISPLAY`/`WL_DISPLAY`; macOS needs CGL.
4. **Copy-back hardware decoding is forced wherever the zero-copy interop is not available.** The manual's hwdec list ties several decoders to a VO: "`videotoolbox`: requires `--vo=gpu` or `--vo=gpu-next` (macOS only), **or `--vo=libmpv` (iOS 9.0 and up)**" — i.e. on macOS `vo=libmpv` cannot use zero-copy `videotoolbox`, which is why Harbor sets `hwdec=videotoolbox-copy`; "`d3d11va`: requires `--vo=gpu` or `--vo=gpu-next` with `--gpu-context=d3d11` or `--gpu-context=angle` (Windows 8+ only)" — with desktop WGL + the render API, ANGLE is the documented requirement for GL/DX interop, so a non-ANGLE Windows GL context ends on `d3d11va-copy`; "`vaapi`: requires `--vo=gpu`, `--vo=gpu-next`, `--vo=vaapi` or `--vo=dmabuf-wayland`" — `vo=libmpv` is not listed, so Linux render-API apps rely on EGL direct interop being set up by the params (cove/`media_kit` pass the native display, which is what makes `vaapi-egl` possible).
5. **Direct rendering requires opting in.** `MPV_RENDER_PARAM_ADVANCED_CONTROL` is what enables (mpv's own words in `render.h`) "**Direct rendering… saves a copy per video frame** (`vd-lavc-dr` option needs to be enabled…)" and "Rendering screenshots with the GPU API if supported by the backend", and it converts the throttling rule into "a **real deadlock** will freeze the mpv core thread forever" if violated. Of the stacks read: **cove desktop sets it to 1**; `media_kit` sets it **nowhere** (grep = 0 hits); `egui-sharkplayer` does not; `mpvqt`/Stremio do not.
6. **You must restore GL state yourself.** `render_gl.h` lists what mpv does not restore: "the `glViewport` state — the `glScissor` state (but `GL_SCISSOR_TEST` is in its default value) — `glBlendFuncSeparate()` state — `glClearColor()` state — mpv may overwrite the callback set with `glDebugMessageCallback()` — mpv always disables `GL_DITHER` at init." Every app above works around it (Qt's `resetOpenGLState()`, the slim fork's manual restore, JOGL's FBO rebind).
7. **Extra copies that the toolkit adds on top of mpv** (not mpv's fault, but real): media_kit Windows does a `CopyResource` per frame plus a `glFinish()`; `media_kit` and sharkplayer target 8-bit BGRA/RGBA; cove/JOGL's `GLJPanel` "renders into an offscreen hardware FBO and then composites as ordinary Swing pixels" (one more composition); iced_mpv's default path is "mpv → CPU RGBA buffer → iced image handle", and its GPU path is "mpv GL → **GL→Vulkan blit** → wgpu texture".
8. **Toolkit-imposed quality regressions on top of the render API**, of which media_kit is the clearest example: `scale=bilinear`, `dscale=bilinear`, `dither=no`, `correct-downscaling=no`, `linear-downscaling=no`, `sigmoid-upscaling=no`, `hdr-compute-peak=no`, `sub-ass=no`.
9. **No `--wid` means no "mpv is a normal window" escape hatch.** Harbor's Linux `main` proves the split: without embedding it just runs mpv in its own window (`vo=gpu-next,`, `force-window=yes`).

### 9.3 LGPL-mode mpv (`-Dgpl=false`) — correcting the common shorthand

mpv's root `Copyright` (https://raw.githubusercontent.com/mpv-player/mpv/master/Copyright):
> "mpv as a whole is licensed under the GNU General Public License GPL version 2 or later… by default. The mpv program is licensed the GNU Lesser General Public License LGPL version 2 or later… if built without using any GPL only files. The `-Dgpl=false` configure switch is provided as a convenience for excluding the GPL only files listed below from the build process. **However, do note that the build system is provided 'as is' and using the `-Dgpl=false` configure switch does not in itself create a LGPLv2.1+ license grant.**"
> "LGPL mode disables the following features, some of them quite central: **Linux X11 video output** — BSD audio output via OSS — NVIDIA/Linux hardware decoding (vdpau, although nvdec usually works) — minor features: jack, DVD, CDDA, DVB, CACA, **legacy direct3d VO**. … The intended use for LGPL mode is **with libmpv**, and currently it's not recommended to build mpv CLI in LGPL mode at all."
> Closing caveat: "Linked libraries still can affect the final license (for example **if FFmpeg was built as GPL**)."

So "no video output in LGPL builds" is too strong. What is actually gated in `meson.build` (line numbers on `master`): `x11` (→ `vo_x11.c`, `vo_xv.c`, and transitively `gl-x11`/GLX and `vdpau`), `direct3d` (`vo_direct3d.c`), `caca` (`vo_caca.c`), plus `jack`, `oss-audio`, `cdda`, `dvbin`, `dvda`, `dvdnav`; and `vaapi-x11` → `vo_vaapi.c` only lands when `features['x11']` is on (so it also falls away in LGPL mode, matching the `Copyright` list). What is **not** GPL-gated and therefore still available: `video/out/vo_libmpv.c`, `video/out/gpu/libmpv_gpu.c`, `video/out/libmpv_sw.c`, `video/out/opengl/libmpv_gl.c`, `video/out/d3d11/libmpv_d3d11.c` (grep for `gpl` over those files → nothing), the `d3d11` feature, Windows `d3d11va`/`d3d11va-copy`, EGL/DRM/nvdec, and the whole render API. `[inference]` an LGPL build on Linux must therefore be an EGL/GBM/DRM build rather than GLX/X11.

On Windows, the prebuilt bundles that the Tauri apps download are GPL, so LGPL mode is not a drop-in: harbor's `src-tauri/setup-libmpv.ps1` / `scripts/fetch-libmpv.mjs` pull `mpv-dev-x86_64-v3.zip` from `https://nightly.link/shinchiro/mpv-winbuild-cmake/workflows/build_libmpv/master/...`, and that project's `packages/ffmpeg.cmake` sets `--enable-gpl` while `packages/mpv.cmake` does not pass `-Dgpl=false` and enables `-Ddvdnav=enabled` (itself a GPL-gated feature). A shinchiro build also ships only `client.h`, `stream_cb.h`, `render.h`, `render_gl.h` in its dev bundle — **no `render_d3d11.h`** (consistent with `libmpv2`'s OpenGL-only `RenderApiType`; see the D3D11 render API note below).

### 9.4 The 0.42 D3D11 render API — relevant to this question, and unreleased

`include/mpv/render.h` (`master`) defines exactly three API-type strings:
```c
#define MPV_RENDER_API_TYPE_D3D11 "d3d11"
#define MPV_RENDER_API_TYPE_OPENGL "opengl"
#define MPV_RENDER_API_TYPE_SW "sw"
```
`DOCS/client-api-changes.rst` files the D3D11 backend under `--- mpv 0.42.0 ---` (client API 2.6) — and `master`'s own `MPV_VERSION` is `0.41.0-UNKNOWN`, with the last tagged release **v0.41.0 (2025-12-21)**. So the one render-API backend that would let a Windows app hand mpv an `ID3D11Texture2D` (and get `d3d11va` on the same device) is **not in any released mpv**; every D3D11 render-API claim in §7.3 ("planned via D3D11/D3D12 shared handle") is therefore forward-looking. `d3d11` (the video-out feature) is not GPL-gated (`meson.build` line ~1066) and `video/out/d3d11/libmpv_d3d11.c` carries no `gpl` gate, so it would be LGPL-available when it ships.

---

## 10. Could not verify / weak sources

1. **`/home/menotifilho/projetos/harbor` does not exist** on this machine; `github.com/harborstremio/harbor` is 404. All Harbor quotes are from `github.com/9000000/harbor@main` (`Cargo.toml` version `0.8.5`), which GitHub reports as the `source` of `MenotiFilho/harbor` (`parent: 3-pr/harbor`). Local notes elsewhere describe a `0.9.21` tree with `librqbit`/`harbor-core`/`torrent_engine.rs`/`stremio_auth.rs` that `main` does not contain; I could not read that tree.
2. **JOGL `GLJPanel`'s actual composition path in cove.** The class comment says it "renders into an offscreen hardware FBO and then composites as ordinary Swing pixels", and the code documents a FBO rebind before "GLJPanel's readback/composition pass". Whether that pass is a texture blit or a `glReadPixels`-style readback in this configuration, and what it costs per frame, was not measured. `[inference]` only that it is an extra composition level.
3. **Whether cove's desktop player loads its own `mpv.conf`.** The backend writes `<dataDir>/mpv/mpv.conf` and exposes it over `GET/PUT /settings/mpv-conf`; the *Android* host sets `config=yes` with a config dir under `filesDir/mpv`. I found no `mpv_load_config_file` or `config-dir` call in the desktop player, so desktop config loading is unverified.
4. **Whether any released/shipped libmpv binary exposes `MPV_RENDER_API_TYPE_D3D11`.** Not verified by inspecting a binary. The header/commit/doc evidence is internally inconsistent by one release: `render_d3d11.h` says `Copyright (C) 2024` but its only commit (`4255130de4`) is dated 2026-04-17, while the client-API doc files the API under the unreleased 0.42.0. Same caveat as the earlier research note in this repo.
5. **`mpvqt`'s repository has no release/tag I verified**, and I read its `master` raw files (`https://invent.kde.org/libraries/mpvqt/-/raw/master/...`) rather than a pinned revision. Jellyfin's submodule points at a specific commit I did not check out (the `external/mpvqt` directory is empty in a non-`--recurse-submodules` clone).
6. **No 4K/HEVC/AV1/HDR benchmarks were found for**: harbor (any platform), ventic, `mpv-examples/libmpv/qml`, Stremio shell / shell-ng beyond the qualitative "2-5x more efficient" README claim, `egui-sharkplayer`, Avalonia/Slint/MAUI precedents, Jellyfin Desktop. The only explicit numeric claims located are media_kit's "4K / 8K 60 FPS is supported" / "easily capable for rendering 4K 60 FPS videos" (README) and `iced_mpv`'s "≈90% of one core" CPU cost at 2160p. Neither is an independent measurement.
7. **`Stremio/stremio-shell-ng` has no license** (`license: null` in the GitHub API) and is Windows-only, so its claims are self-reported. `Stremio/stremio-shell` is GPL-3.0 but **Qt 5** — its ANGLE-related behaviour is Qt-5-specific and I did not test whether Qt 6 changes it beyond what the Jellyfin code and Qt docs show.
8. **Electron/PPAPI removal attribution.** I verified that `ppapi/` and `content/renderer/pepper` are absent from Chromium `main` (HTTP 404, 2026-10-15) and that `register-pepper-plugins` is gone from `content_switches.cc`, while Electron's `webPreferences.plugins` doc entry still exists ("Whether plugins should be enabled. Default is `false`."). I did **not** find a first-party statement naming the Chromium milestone that removed PPAPI, so `[inference]`-labelled: mpv.js's mechanism is unavailable in current Electron.
9. **The exact `ElectronMpvPlayer`/`bm-player`/`Stellaflix`/`NetWatch` Electron+mpv implementations** were located by code search but not read; I only used them as existence evidence and read `icebang01/lumora` and `Newish0/mpv-electron`.
10. **A Slint widget with first-party GL texture hand-off.** `maurges/slint-mpv-widget`'s README explicitly complains that Slint does not provide one; I did not check whether Slint has since added one.
11. **`mpv.js`'s exact render path** (render API into an HTML canvas via PPAPI) is inferred from its README ("mpv pepper plugin", `register-pepper-plugins`) plus its C++ source language; I did not read its C++ to confirm `vo=libmpv`.
12. **`j-holub/Node-MPV`, `husudosu/mpv-remote-node`, `raksooo/mpv-controller`** were only classified from descriptions (process + IPC, no in-window video). Not read.
13. **WordPress-style date skew in this environment.** Some sources carry dates that look shifted (e.g. `MPV_VERSION = 0.41.0-UNKNOWN` on `master` while v0.41.0 was released 2025-12-21, and 2026-10-15 is "today"). All dates are reported exactly as the sources state them.

---

## Appendix — source inventory

| Item | Version / commit / date as read | License |
|---|---|---|
| `mpv` (`/tmp/opencode/mpv-master`) | `MPV_VERSION` 0.41.0-UNKNOWN; last tag v0.41.0 (2025-12-21); `client-api-changes.rst` top entry `--- mpv 0.42.0 ---` | GPLv2+ default; LGPLv2.1+ in `-Dgpl=false` (`Copyright`) |
| `libmpv2` crate | 6.0.0 (crates.io tarball), depends on `libmpv2-sys` 4.0.1 | LGPL-2.1 |
| `egui-sharkplayer` | 0.5.1, `eframe 0.35` + `libmpv2 6.0` | Unlicense |
| `media-kit/media-kit` | HEAD `c533e446755f51cf53c7e57aea873f2aa5355f81` (2026-08-30); `media_kit` 1.2.6, `media_kit_video` 2.0.1 | MIT; 1,842★ |
| `coveninja/cove` | `VERSION` 1.6.0; pushed 2026-10-09 | AGPL-3.0; 150★ |
| `jellyfin-media-player` → `jellyfin-desktop` | `VERSION` 2.0.0-dev; HEAD `2cb4a4456fd29b5b62d825ef0e5df93ed6913328` (2026-08-31) | GPL-2.0; 5,871★ |
| `invent.kde.org/libraries/mpvqt` | `master` raw files fetched 2026-10-15 | `LGPL-2.1-only OR LGPL-3.0-only OR LicenseRef-KDE-Accepted-LGPL` |
| `9000000/harbor` | `Cargo.toml` 0.8.5; pushed 2026-06-04 | MIT; 3★ |
| `ventic/ventic` | `tauri.conf.json` 0.7.5; pushed 2026-10-15 | MIT; 177★ |
| `Stremio/stremio-shell` | `CMakeLists.txt` `project(stremio VERSION "4.4.183")`; Qt 5; pushed 2026-03-27 | GPL-3.0; 928★ |
| `Stremio/stremio-shell-ng` | pushed 2026-10-13 | **none declared**; 91★ |
| `mpv-player/mpv-examples` (`libmpv/qml`, `libmpv/qt_opengl`, `libmpv/qt`) | read 2026-10-15 | ISC-like header in `render.h` |
| `SaverinOnRails/Mpv.Avalonia` | pushed 2025-09-21 | none declared; 27★ |
| `Naylor55/AvaloniaMpv` | pushed 2024-03-22 | Apache-2.0; 13★ |
| `parintorn0/LibMpv.Avalonia` | pushed 2026-05-05 | MIT; 0★ |
| `maurges/slint-mpv-widget` | pushed 2024-02-11 | none declared (MIT header in `src/mpv.rs`); 3★ |
| `ophymx/iced_mpv` | pushed 2026-09-06; README verified 2026-09-05 | Apache-2.0; 1★ |
| `Kagami/mpv.js` | pushed 2024-01-17 | CC0-1.0; 446★ |
| `icebang01/lumora` | Electron 33; pushed 2026-08-17 | `NOASSERTION` (README says UNLICENSED); 0★ |
| `Newish0/mpv-electron` | pushed 2024-05-19 | GPL-2.0; 1★ |
| `kankejiang/CatClawVideo` | pushed 2026-10-15 | MIT; 19★ |
| `Richasy/mpv-winui` | pushed 2025-05-25 | MIT; 11★ |
| `homov/LibMpv` (C# wrapper used by Avalonia projects) | pushed 2023-10-08 | MIT; 54★ |
| `mpvnet-player/mpv.net` (contrast: GPL `wid` app) | `src/MpvNet/Player.cs`: `SetPropertyLong("wid", formHandle.ToInt64())` | GPL-2.0; 5,484★ |
