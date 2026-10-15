# libmpv embedding + custom UI: fact-finding

**Date of research:** 2026-10-15. All GitHub/API/raw file reads were done on this date.
**Scope:** verifiable facts only. No recommendations. Inferences are labelled `[inference]`; anything I could not confirm is in §9.

**Environment note:** mpv `master` currently reports `MPV_VERSION = 0.41.0-UNKNOWN`; the last tagged release is **v0.41.0, published 2025-12-21** (`https://api.github.com/repos/mpv-player/mpv/releases`). That matters because the D3D11 render API is only documented under a `--- mpv 0.42.0 ---` heading in `DOCS/client-api-changes.rst` (see §1.2).

---

## 0. Source status (read this first)

| Target | Status | Evidence |
|---|---|---|
| `/home/menotifilho/projetos/harbor` | **Does not exist.** Only `/home/menotifilho/projetos/harbor-companion` (a Flutter/Dart Android remote) is present. | `ls /home/menotifilho/projetos/`; `find /home/menotifilho -iname '*harbor*'` |
| `github.com/harborstremio/harbor` | **404** (user `harborstremio` exists, has 0 public repos) | `curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/harborstremio/harbor` → `404`; `https://api.github.com/users/harborstremio/repos` → `[]` |
| `github.com/9000000/harbor` | **Exists, MIT, 3 stars, created 2026-06-04, default branch `main`.** It is the *source* repo of `MenotiFilho/harbor` (fork) — see `https://api.github.com/repos/MenotiFilho/harbor` → `"source": "9000000/harbor"`, `"parent": "3-pr/harbor"`. | GitHub API |
| `MenotiFilho/harbor` (`menoti/slim`) | The parked fork named in this repo's `docs/adr/0001-clean-room-rebuild-parked-harbor-fork.md`. It contains **additional** code not in upstream `main` (`src-tauri/src/mpv_render_linux.rs`). | `https://api.github.com/repos/MenotiFilho/harbor/branches` |

**The Harbor code I quote in §2.1 is from `9000000/harbor@main`**, which the described stack matches (Tauri 2 + React 19 + TS + Rust + `libmpv2`), but which is **not** a revision I can tie to the 0.9.21 described in `/home/menotifilho/projetos/tarefasGerais/arquivos/pesquisa-harbor-stremio.md`. Concretely: `9000000/harbor@main` `src-tauri/Cargo.toml` says `version = "0.8.5"` and has **no `librqbit` dependency and no `harbor-core` / `torrent_engine.rs` / `stremio_auth.rs`**, whereas the local notes describe a 0.9.21 tree that has all three. Treat the code quotes as **a real, verifiable Tauri+libmpv implementation of the same class of app**, not necessarily the exact tree you have locally.

Local files that informed the framing: `docs/adr/0001-…`, `docs/adr/0003-embedded-libmpv-own-player-ui.md`, `docs/adr/0004-gpl3-with-stock-gpl-mpv.md`, `CONTEXT.md`, and `/home/menotifilho/projetos/tarefasGerais/arquivos/pesquisa-harbor-stremio.md`.

---

## 1. libmpv render API (`MPV_RENDER_API_TYPE_*`)

### 1.1 What exists

`include/mpv/render.h` (raw: `https://raw.githubusercontent.com/mpv-player/mpv/master/include/mpv/render.h`) defines exactly three API-type strings:

```c
// See render_d3d11.h
#define MPV_RENDER_API_TYPE_D3D11 "d3d11"
// See render_gl.h
#define MPV_RENDER_API_TYPE_OPENGL "opengl"
// See section "Software renderer"
#define MPV_RENDER_API_TYPE_SW "sw"
```

The header's own "Supported backends" block:

> ```
> Direct3D 11: via MPV_RENDER_API_TYPE_D3D11, see render_d3d11.h header.
> OpenGL: via MPV_RENDER_API_TYPE_OPENGL, see render_gl.h header.
> Software: via MPV_RENDER_API_TYPE_SW, see section "Software renderer"
> ```

**There is no Vulkan render API.** `grep -ri vulkan include/` over mpv `master` returns nothing. Vulkan exists in mpv only *inside* the `gpu`/`gpu-next` VOs (`--gpu-api=vulkan`, `--gpu-context=displayvk`/`waylandvk`/`x11egl`), i.e. when mpv owns or is given a window — not through the render API.

### 1.2 Which version added what

Source: `DOCS/client-api-changes.rst` (`https://raw.githubusercontent.com/mpv-player/mpv/master/DOCS/client-api-changes.rst`). The file groups changes under `--- mpv X.Y.Z ---` headings.

| `MPV_RENDER_*` thing | Client-API ver | mpv release (per doc heading) | Notes |
|---|---|---|---|
| `render.h` + `render_gl.h` (OpenGL render API) replacing `opengl_cb` | 1.28 | **mpv 0.29.0** | "deprecate the render opengl_cb API, and replace it with render.h and render_gl.h" |
| `MPV_RENDER_PARAM_ADVANCED_CONTROL`, `NEXT_FRAME_INFO`, `BLOCK_FOR_TARGET_TIME`, `SKIP_RENDERING`, `mpv_render_context_get_info()` | 1.101 | **mpv 0.29.0** | |
| Deadlock fixes for `ADVANCED_CONTROL`; must call all render fns from the create thread | 1.105 | **mpv 0.30.0** | |
| `MPV_RENDER_API_TYPE_SW` + `MPV_RENDER_PARAM_SW_SIZE/FORMAT/STRIDE/POINTER` | 1.109 | **mpv 0.33.0** | |
| DRM display v2 params | 1.102 / 1.104 | mpv 0.29.0 / 0.30.0 | Linux DRM only |
| `MPV_RENDER_API_TYPE_D3D11`, `MPV_RENDER_PARAM_D3D11_INIT_PARAMS`, `MPV_RENDER_PARAM_D3D11_FBO`, `render_d3d11.h` | **2.6** | **`--- mpv 0.42.0 ---`** | **Not in any released mpv.** See the inconsistency note below. |
| `MPV_RENDER_PARAM_AMBIENT_LIGHT` deprecated | 2.5 | mpv 0.40.0 | |

**Inconsistency I could not resolve:** `include/mpv/render_d3d11.h` carries `Copyright (C) 2024`, but `https://api.github.com/repos/mpv-player/mpv/commits?path=include/mpv/render_d3d11.h` returns exactly one commit, `4255130de4`, author date `2026-04-17T19:10:43Z`, message `libmpv: add D3D11 render API backend`. Either the copyright year is aspirational or the API was drafted in 2024 and merged in 2026. I report the commit date as the API returned it.

### 1.3 What each backend actually gives you

| Backend | What you supply | What you get | HW decode support |
|---|---|---|---|
| `OPENGL` (`render_gl.h`) | a **current** GL context on the calling thread + `get_proc_address` callback; `mpv_opengl_fbo{fbo,w,h,internal_format}` per frame | mpv draws the video into *your* FBO. You can then sample that FBO's texture, or draw your UI into the same FBO after mpv. | "fully supported, but requires some additional setup". Per `render_gl.h`: **Windows: ANGLE is required** (GL/DX interop "in theory" possible); Intel/Linux: EGL + native display (`MPV_RENDER_PARAM_X11_DISPLAY` or `MPV_RENDER_PARAM_WL_DISPLAY`); nVidia/Linux: GLX and EGL; macOS: CGL; iOS: EAGL. |
| `SW` (`render.h` "Software renderer") | `SW_SIZE`, `SW_FORMAT` (`rgb0`/`bgr0`/`0bgr`/`0rgb`/`rgb24`), `SW_STRIDE`, `SW_POINTER` | RGB pixels in **system memory**, CPU-only, single-threaded, incl. colour conversion, scaling and OSD. mpv's own words: "extremely simple (but slow)… You probably don't want to use this." `FLIP_Y` and `DEPTH` ignored. | none (copy-back only) |
| `D3D11` (`render_d3d11.h`) | `ID3D11Device`; `mpv_d3d11_fbo{tex}` | mpv renders into your `ID3D11Texture2D` via the immediate context. You own/present the texture. | `d3d11va` decodes **on the device you pass**; mpv enables multithread protection on it. A `D3D11_CREATE_DEVICE_SINGLETHREADED` device only supports `d3d11va-copy`. |

`render_d3d11.h` constraints (verbatim highlights): texture must be 2D, `D3D11_BIND_RENDER_TARGET`, `D3D11_USAGE_DEFAULT`, **not** multisampled, **not** a texture array, **not** mipmapped. Supported formats: `DXGI_FORMAT_B8G8R8A8_UNORM`, `R8G8B8A8_UNORM`, `R10G10B10A2_UNORM`, `R16G16B16A16_FLOAT`; **sRGB formats are not supported**. Threading differs from GL:

> "Unlike OpenGL, Direct3D 11 does not use a per-thread implicit context. Any thread may call the mpv_render_* functions with this backend… Other threads must not use the immediate context while an mpv_render_* function runs."

And state: "mpv renders with the immediate context of the device and does not restore its state, so the API user has to set its own state again after calling the mpv_render_* functions."

### 1.4 Can wgpu / Vulkan consume mpv frames?

**Not directly.** Facts:

1. The render API has no Vulkan backend (§1.1). mpv will never hand you a `VkImage`.
2. With `OPENGL` you get frames in a GL FBO — usable by wgpu **only** through a GL↔wgpu/wgpu-hal interop path or a GPU→CPU/GPU→GPU copy. [`inference`] wgpu's `Texture::from_raw`-style external-memory paths are backend-specific and not a documented mpv feature.
3. With `D3D11` you get frames in an `ID3D11Texture2D` — this *is* a plausible wgpu (D3D12/Vulkan) source via a shared/keyed-mutex texture, but that is your interop code, not mpv's, and the D3D11 render API is unreleased (§1.2).
4. With `SW` you get CPU pixels; the round trip is explicit and slow.
5. `egui-sharkplayer`'s own docs state the trade-off plainly: "The video player works best with the `glow` backend because **libmpv2's render API only supports OpenGL**. When using the `wgpu` feature, instead of a direct VRAM copy, image data has to roundtrip through main system memory." (`https://docs.rs/egui-sharkplayer/latest/egui_sharkplayer/`)

### 1.5 Drawing your own UI on top of mpv's frames

The render API is a **frame producer, not a compositor**. `mpv-examples/libmpv/README.md` (`https://raw.githubusercontent.com/mpv-player/mpv-examples/master/libmpv/README.md`) states the contract:

> "This method lets you use libmpv's OpenGL renderer directly. You create an OpenGL context, and then use `mpv_render_context_render()` to render the video…
> You also get much more flexibility. For example, you can actually render **your own OSD on top of the video**, something that is **not possible with raw window embedding**."

Two documented techniques:

* Render mpv into an FBO, then draw your UI over it (or into the same framebuffer after `mpv_render_context_render()` returns). Qt's own example does exactly this — see §7.
* `MPV_RENDER_PARAM_SKIP_RENDERING` (type `int*`, 0=render/1=skip): "If this is set, you don't need to pass a target surface… the render API will consider this frame as having been rendered. All other normal rules also apply, for example about whether you have to call `mpv_render_context_report_swap()`."
* `MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME` (0/1, default 1) lets you stop mpv blocking inside `render()` until presentation time and do the wait yourself using `mpv_render_frame_info.target_time`.

### 1.6 `ADVANCED_CONTROL`, threading, and the callback contract

Quoted from `include/mpv/render.h`:

`MPV_RENDER_PARAM_ADVANCED_CONTROL` (type `int*`, 0=disable default, 1=enable) "conflates multiple requirements the API user promises to abide if this option is enabled":
* the render thread "never waits for the core. Otherwise deadlocks can happen";
* "The callback set with `mpv_render_context_set_update_callback()` can now be called **even if there is no new frame**. The API user should call `mpv_render_context_update()`, and interpret the return value for whether a new frame should be rendered";
* "Correct functionality is impossible if the update callback is not set, or not set soon enough after `mpv_render_context_create()`".

It enables (mpv's words) "Direct rendering… saves a copy per video frame (`vd-lavc-dr` option needs to be enabled…)" and "Rendering screenshots with the GPU API if supported by the backend". Warning verbatim: "do not just add this without reading the 'Threading' section above, and then wondering that deadlocks happen… Enabling advanced controls simply makes violating these rules fatal."

Threading rules (verbatim, condensed):
* only one `mpv_render_*` call at a time (per core);
* "never can be called from within the callbacks set with `mpv_set_wakeup_callback()` or `mpv_render_context_set_update_callback()`";
* GL backend: the GL context "must be 'current' in the calling thread, and it must be the same OpenGL context as the `mpv_render_context` was created with. Otherwise, undefined behavior will occur";
* no lock/wait dependency from render thread back into a thread using non-safe libmpv functions; otherwise deadlocks that are non-fatal but degrade playback, logging `mpv_render_context_render() not being called or stuck.`;
* if `ADVANCED_CONTROL` set → "you promise that this won't happen, and must absolutely guarantee it, or a **real deadlock** will freeze the mpv core thread forever";
* safe on the render thread: functions marked `Safe to be called from mpv render API threads.`, `client.h` functions without an `mpv_handle` parameter, and `mpv_render_*` for the *same* context pointer;
* "Currently, there can be only 1 `mpv_render_context` at a time per mpv core."

`mpv_render_context_update()`: "The API user is supposed to call this when the update callback was invoked… This is optional if `MPV_RENDER_PARAM_ADVANCED_CONTROL` was not set (default). Otherwise, it's a **hard requirement**". Returns a bitset; currently only `MPV_RENDER_UPDATE_FRAME`.

Frame info flags: `PRESENT`, `REDRAW`, `REPEAT`, `BLOCK_VSYNC`; plus `int64_t target_time`.

### 1.7 `--wid` window embedding vs the render API

`include/mpv/client.h`, "Embedding the video window":

> "Using the render API (in render.h) is recommended… **There is an older way to embed the native mpv window into your own.** You have to get the raw window handle, and set it as `wid` option. **This works on X11, win32, and macOS only.** It's much easier to use than the render API, but also has various problems."

The mpv manual (`https://mpv.io/manual/master/`, `--wid=<ID|-1>`) says: "On X11, the ID is interpreted as a `Window` on X11… The value 0 is interpreted specially, and mpv will draw directly on the root window. On win32, the ID is interpreted as `HWND`… On Android requires `--wid` be set to an `android.view.Surface`" (under `mediacodec_embed`). **The manual's `--wid` text does not mention macOS**, while `client.h` does — a documented inconsistency.

`mpv-examples/libmpv/README.md` on window embedding:

> "Both on X11 and win32, the player will fill the window referenced by the 'wid' option…" and on the render API: "In some cases, window embedding can be preferable, because it is simpler and has fewer requirements (e.g. no dependency on OpenGL…)."

**The key structural difference:** with `--wid`, *mpv picks its own VO* (`gpu-next`/`gpu` with `d3d11`/`vulkan`/`opengl`, or `mediacodec_embed`), so you get mpv's whole pipeline unmodified. With the render API, *you* own the graphics context and mpv only fills your surface, restricted to the three API types above.

**`--vo=libmpv`** is the VO registered by `video/out/vo_libmpv.c`, whose descriptor is:

```c
const struct vo_driver video_out_libmpv = {
    .description = "render API for libmpv",
    .name = "libmpv",
```
It is not the default VO. `DOCS/client-api-changes.rst` 2.3 (mpv 0.38.0): "remove libmpv as the default VO and move it to the bottom of the auto-probing order."

**`DOCS/man/libmpv.rst`** is a ~3 KB stub. Its entire content for §1 is: "The recommended way to do so is using libmpv. See `include/mpv/client.h` in the mpv source code repository… further documentation is spread over a few places" — it points to `client.h`, `mpv.io/manual/master`, and `github.com/mpv-player/mpv-examples/tree/master/libmpv`. There is **no prose render-API documentation in the mpv repo outside the header comments.**

---

## 2. How real apps put custom UI + embedded libmpv in one window

### 2.1 Harbor (Tauri 2 + React + Rust + libmpv) — three different mechanisms per platform

Repo read: `https://github.com/9000000/harbor` @ `main` (MIT). Files under `src-tauri/src/`.

**Windows — child HWND via `wid`, WebView2 made transparent, mpv forced to `HWND_BOTTOM` + click-through.**

`src-tauri/src/mpv.rs`:
```rust
fn apply_pre_init(init: &MpvInitializer, args: &MpvStartArgs, embed_hwnd: Option<&str>) -> Result<(), String> {
    ...
    if let Some(hwnd) = embed_hwnd {
        #[cfg(windows)]
        {
            let hwnd_i64: i64 = hwnd.parse()...;
            init.set_property("wid", hwnd_i64)...;
        }
```
`embed_hwnd` comes from `get_main_hwnd_str()` → `app.get_webview_window("main")?.hwnd()`. The child is then located by class name and repositioned:
```rust
let is_mpv = class_name == "mpv" || class_name.starts_with("mpv ") || (class_name.is_empty() && title.starts_with("Harbor"));
...
SetWindowPos(target, Some(HWND_BOTTOM), x, y, w as i32, h as i32, SWP_NOACTIVATE | SWP_SHOWWINDOW);
let want_ex = cur_ex | WS_EX_TRANSPARENT.0 as i32;
SetWindowLongW(target, GWL_EXSTYLE, want_ex);
SetWindowSubclass(target, Some(mpv_subclass_proc), HARBOR_MPV_SUBCLASS_ID, 0);
```
```rust
unsafe extern "system" fn mpv_subclass_proc(...) -> LRESULT {
    if msg == WM_NCHITTEST { return LRESULT(HTTRANSPARENT as isize); }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}
```
WebView2 transparency is forced separately in `src-tauri/src/webview_helpers.rs`:
```rust
let controller = webview.controller();
let controller2 = controller.cast::<ICoreWebView2Controller2>()?;
let color = COREWEBVIEW2_COLOR { A: 0, R: 255, G: 255, B: 255 };
controller2.SetDefaultBackgroundColor(color);
```
`src-tauri/tauri.windows.conf.json` ships `libmpv/libmpv-2.dll` as a resource; `src-tauri/setup-libmpv.ps1` and `scripts/fetch-libmpv.mjs` pull the dev bundle from `https://nightly.link/shinchiro/mpv-winbuild-cmake/workflows/build_libmpv/master/mpv-dev-x86_64-v3.zip`. Windows-only deps: `windows = "0.61"`, `webview2-com = "0.37"`, `window-vibrancy = "0.6"`.

**macOS — render API (OpenGL) into an `NSOpenGLView` placed *below* the WKWebView, webview made non-opaque.** `src-tauri/src/mpv.rs` sets `vo=libmpv`, `force-window=no`, `hwdec=videotoolbox-copy`; `src-tauri/src/mpv_render_mac.rs`:
```rust
let view_alloc = NSOpenGLView::alloc(mtm);
let view: Option<Retained<NSOpenGLView>> = msg_send![view_alloc, initWithFrame: bounds, pixelFormat: &*pf];
...
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
render.render::<()>(0, w, h, true)   // FBO 0, flip_y = true
```
Redraw is marshalled to the main thread via `dispatch_async_f(dispatch_get_main_queue())`.

**Linux — no embedding at all in `main`.** `get_main_hwnd_str` for `cfg(all(not(windows), not(target_os="macos")))` is `fn get_main_hwnd_str(_app) -> Option<String> { None }`, so `use_render_api = cfg!(target_os="macos") && want_embed` is false, `vo` stays `gpu-next,`, `force-window=yes`, and geometry is pushed with the `geometry` property (`mpv_set_geometry` → `mpv.set_property("geometry", "WxH+X+Y")`). The frontend's placeholder text says it out loud: `"mpv plays in its own window. Controls remain here."` (`src/lib/player/mpv.ts`).

**Frontend side:** `src/views/player/hooks/use-mpv-embed.ts` computes cut-out rectangles from the DOM and calls `invoke("mpv_set_clip_rects", { rects })`; `src/lib/player/mpv.ts` polls `opts.getEmbedRect()` on a **250 ms** timer and calls `invoke("mpv_set_geometry", { geom })`. **`mpv_set_clip_rects` is a stub in `main`:** `pub async fn mpv_set_clip_rects(_app: AppHandle, _rects: Vec<MpvClipRect>) -> Result<(), String> { Ok(()) }`. So on Windows, Harbor relies purely on "WebView2 transparent above, mpv child HWND at bottom, click-through", not on region shaping.

### 2.1b The parked fork `MenotiFilho/harbor@menoti/slim` — adds a Linux render-API backend

This branch adds `src-tauri/src/mpv_render_linux.rs` (19,784 bytes) and changes the dispatch to:
```rust
let use_render_api = (cfg!(target_os = "macos") || cfg!(target_os = "linux")) && want_embed;
...
} else {
    mpv.set_property("vo", "libmpv");
    let _ = mpv.set_property("force-window", "no");
}
```
It installs libmpv's render API into a GTK3 `GLArea` inside a `gtk::Overlay`, with the Tauri WebKitGTK webview as the overlay child:
```rust
let overlay = gtk::Overlay::new();
let area = gtk::GLArea::new();
area.set_auto_render(false);
area.set_use_es(false);
overlay.add(&area);
overlay.add_overlay(&web_view);
overlay.set_overlay_pass_through(&web_view, false);
```
Render context is built with the platform native display:
```rust
match backend {
    Backend::X11     => params.push(RenderParam::X11Display(ptr)),
    Backend::Wayland => params.push(RenderParam::WaylandDisplay(ptr)),
}
```
Frame loop reads GTK's own FBO id (`glGetIntegerv(GL_FRAMEBUFFER_BINDING)`) and calls `rc.render::<()>(fbo, w, h, true)`, then **restores GDK's GL state** because `render_gl.h` says mpv does not restore `glViewport`/`glScissor`/`glBlendFuncSeparate`/`glClearColor` and GDK relies on those to composite the webview in the same context.

Operational constraints documented in that file's comments (all load-bearing):
* WebKit only gives transparent webview backgrounds inside the **accelerated compositor** (WebKit bug 192305), so `WEBKIT_DISABLE_COMPOSITING_MODE` must **not** be set; there is a `HARBOR_LINUX_LEGACY_GFX=1` escape hatch.
* NVIDIA + Wayland ⇒ sets `__NV_DISABLE_EXPLICIT_SYNC=1`.
* `apply_rgba_visual()` + `set_app_paintable(true)` as a precondition for transparency; warns that GTK3 ignores `set_visual` after realize, so it "is a no-op on an already mapped Tauri window".
* Warns that a `GLArea` FBO query returning 0 means "mpv will render to the default framebuffer and the video region will stay BLACK".
* `resize_to()` is a documented no-op on Linux: "On Wayland, the GLArea fills the full window via GTK expand flags, so geometry tracking is not needed."
* Windows still uses `wid` on this branch; hwdec is `d3d11va` if RTX Video is on, else `auto-safe`.

### 2.2 Ventic (`ventic/ventic`) — real mpv *process* + `--wid` + X Shape / Win32 region

Repo: `https://github.com/ventic/ventic` — MIT, 176★, Nuxt 4 + Tauri 2. README: "On Linux and Windows the Rust side parents an actual mpv window into the page and keeps it glued to a box in the layout." Mechanism, verbatim from `src-tauri/src/player.rs`:

> "We run a normal mpv process but (a) parent its video into a child X11 window we create inside the app window (`--wid`), positioned/sized to track a DOM element… and (b) drive it entirely over mpv's JSON IPC socket."

> "The native surface always paints **above** the webview, so DOM controls can never be composited on top of the video. Shaping gets the same result the other way round: cut the control-bar rectangles *out* of mpv's window and the page underneath shows through the holes — rendering and input both, since a window's input region follows its bounding shape."

Implementation: `XShapeCombineRegion` bound by hand out of `libXext` (`SHAPE_BOUNDING`, `SHAPE_SET`), building one whole region client-side per frame (`XCreateRegion` / `XUnionRectWithRegion` / `XSubtractRegion`). It forces `GDK_BACKEND=x11` before GTK init, with the comment "mpv can only embed into an X11 window, so the app window has to be one… XID and playback would fail with 'App window is not X11'."

Windows (`src-tauri/src/player_windows.rs`) is the same shape but with a Win32 region instead of X Shape:
> "the control cutouts are a window region instead of an X Shape mask. A region clips painting *and* hit testing, and it clips descendants too, so mpv's own window inside ours is cut the same way." (`CreateRectRgn`/`CombineRgn(RGN_DIFF)`/`SetWindowRgn`)
> "mpv creates its embedded window **disabled** (`EnableWindow(w32->window, 0)`, unconditional for every `--wid` embed), so unlike on X11 it never receives a click, a wheel notch or a key press".

macOS: Ventic does **not** embed a process — README: "the app links libmpv, asks for `vo=libmpv`, and draws the frames itself into an OpenGL view *under* the webview, with the page made see-through down to the video box." It also notes "mpv's Cocoa output takes no `--wid` — the manual offers it for X11, win32 and Android only."

README summary of the mechanism (the "crux" restated): "The native mpv surface paints *above* the webview, so the controls can't just be stacked over it in CSS. Every overlay marks itself, its rectangle is measured each frame, and the Rust side subtracts it from mpv's window with the X Shape extension — the page shows through the holes, clicks included, while the video window itself never resizes."

### 2.3 Stremio's two shells

**`Stremio/stremio-shell`** — Qt5, C++, **GPL-3.0**, 928★, last push 2026-03-27. Uses **the render API into a `QQuickFramebufferObject::Renderer`**. `mpv.cpp`:
```cpp
class MpvRenderer : public QQuickFramebufferObject::Renderer {
    QOpenGLFramebufferObject *createFramebufferObject(const QSize &size) {
        if (!obj->mpv_gl) {
            mpv_opengl_init_params gl_init_params{get_proc_address_mpv, nullptr, nullptr};
            mpv_render_param params[]{
                {MPV_RENDER_PARAM_API_TYPE, const_cast<char *>(MPV_RENDER_API_TYPE_OPENGL)},
                {MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl_init_params},
                {MPV_RENDER_PARAM_INVALID, nullptr}};
            if (mpv_render_context_create(&obj->mpv_gl, obj->mpv, params) < 0) throw ...;
            mpv_render_context_set_update_callback(obj->mpv_gl, on_mpv_redraw, obj);
        }
        return QQuickFramebufferObject::Renderer::createFramebufferObject(size);
    }
    void render() {
        obj->window()->resetOpenGLState();
        QOpenGLFramebufferObject *fbo = framebufferObject();
        mpv_opengl_fbo mpfbo{static_cast<int>(fbo->handle()), fbo->width(), fbo->height(), 0};
        int flip_y{0};
        mpv_render_param params[] = {
            {MPV_RENDER_PARAM_OPENGL_FBO, &mpfbo},
            {MPV_RENDER_PARAM_FLIP_Y, &flip_y},
            {MPV_RENDER_PARAM_INVALID, nullptr}};
        mpv_render_context_render(obj->mpv_gl, params);
        obj->window()->resetOpenGLState();
    }
};
```
Also: `initialize_mpv()` sets `vo=libmpv` in the QML example; the shell requests `DwmEnableMMCSS(TRUE)` on Windows. `get_proc_address_mpv` uses `QOpenGLContext::currentContext()->getProcAddress(...)`. The shell's own README says nothing about the render mechanism — this is read from source.

**`Stremio/stremio-shell-ng`** — Rust + WebView2, **Windows-only**, **no declared license** (`license: None` in the GitHub API), 91★, last push 2026-10-13. Its README states the rationale verbatim:

> "In all three, this architecture excels the Qt-based shell: it is about **2-5x more efficient** depending on the use case, as it allows MPV to render directly in the window through it's optimal video output rather than using libmpv to integrate with Qt.
> This is due to **Qt having a complex rendering pipeline involving ANGLE and multiple levels of composing and drawing to textures, which inhibits full HW acceleration.**
> Meanwhile in this setup MPV uses whichever pipeline it considers to be optimal (like the mpv desktop app), which is normally **d3d11**, allowing full HW acceleration."

Mechanism (`src/main.rs` / `src/stremio_app/stremio_player/player.rs`): it is **`wid` embedding**, not the render API:
```rust
fn create_mpv(window_handle: HWND) -> Mpv {
    let mpv = Mpv::with_initializer(|initializer| {
        macro_rules! set_property { ($name:literal, $value:expr) => { initializer.set_property($name, $value)... }; }
        set_property!("wid", window_handle as i64);
        set_property!("hwdec", "auto");
        set_property!("vo", "gpu-next,gpu,");
        let mut options = vec![
            ("gpu-context", "d3d11"),
            ("d3d11-output-format", "auto"),
            ("d3d11-output-csp", "auto"),
            ("target-colorspace-hint", "auto"),
            ("tone-mapping", "bt.2390"),
            ...
```
The window handle comes from `tauri::window::Window::hwnd()`. So shell-ng's claim is precisely: **let mpv own its d3d11 swapchain inside the app HWND** (fast), rather than have libmpv render into Qt's GL/ANGLE pipeline (slow). Note this is an argument for `--wid` over the render API *on Windows*, and it is about the render path, not about the UI layer.

### 2.4 Other open-source desktop apps embedding libmpv with custom UI

| App | License | Mechanism (verified) |
|---|---|---|
| **mpv.net** (`mpvnet-player/mpv.net`) | **GPL-2.0**, 5,484★, C#/WPF+WinForms, Windows | `src/MpvNet/Player.cs`: `MainHandle = mpv_create(); … SetPropertyLong("wid", formHandle.ToInt64());` then `mpv_initialize(MainHandle)`. A second `mpv_create_client(MainHandle, "mpvnet")` handle drives commands. WPF chrome + WinForms panel for video. |
| **mpv-easy** (`mpv-easy/mpv-easy`) | **no license file**, 141★, TypeScript/React | **Not a host app.** "TS and React toolkit for mpv *script*" — React UI rendered *inside* mpv's own OSD via scripts. Different category; listed here to rule it out. |
| **MPV-EASY Player** (`422658476/MPV-EASY-Player`) | **GPL-3.0**, 1,446★, C# | A Windows player "based on mpv". I did not read its source; listed because the name collides with the above. |
| **Celluloid** | (not checked) | Referenced by the media_kit README as a Flatpak/libmpv packaging example only. |
| **mpv's own examples** | BSD-ish (`libmpv/Copyright` is the ISC-like header in `render.h`) | `mpv-examples/libmpv/csharp` = Windows Forms + native window embedding; `libmpv/qt` = widget embedding; `libmpv/qt_opengl` = render API in Qt widgets; `libmpv/qml` = render API in QtQuick2; `libmpv/sdl` = render API; `libmpv/cocoa` and `libmpv/cocoa-rendergl` = macOS. |

---

## 3. Tauri / WebView2 specifics

### 3.1 Windows

* **WebView2 is an HWND-based child control.** Per `learn.microsoft.com` "Windowed vs. Visual hosting of WebView2": "Windowed hosting means that in your app, WebView2 content is hosted directly in a window; that is, an HWND. The WebView2 HWND inherits many default properties from the operating system." `CoreWebView2Controller` "takes a parent `HWND`. The `Bounds` property sizes and positions the WebView2 relative to the parent `HWND`."
* **Transparency:** `CoreWebView2Controller.DefaultBackgroundColor`: "Currently this API only supports opaque colors and transparency. It will fail for colors with alpha values that don't equal 0 or 255 i.e. **translucent colors are not supported**. It also does not support transparency on Windows 7. On any OS above Win7, choosing a transparent color will result in showing hosting app content." There is a known white-flicker issue and a `WEBVIEW2_DEFAULT_BACKGROUND_COLOR` env-var workaround. Tauri's own JS API documents the same restriction: "On Windows higher than 7: translucent colors are not supported so any alpha value other than `0` will be replaced by `255`."
* **A native video surface and the webview can coexist, but z-order is the whole game.** Because both are child HWNDs of the Tauri window, whichever is below loses. Harbor proves the working configuration on Windows: mpv child HWND at `HWND_BOTTOM`, `WS_EX_TRANSPARENT` + `WM_NCHITTEST → HTTRANSPARENT`, WebView2 background alpha 0 (§2.1). Ventic proves the inverse configuration (mpv above, region cut-outs).
* **Known long-standing problems with the other direction** (native GPU content under a webview):
  * Tauri issue **#8246 "Render WebView on Top of Native GPU Rendered Content [feat]"** — opened 2023-11-17, **closed 2024-03-28**. Maintainer `amrbashir`: "v2 beta has an `unstable` cargo feature, when enabled, will allow you to create a window and multiple webviews as children, so you can render OpenGL (or similar) on the window and place a webview on top of it. This **however has limitation on X11**." (`https://github.com/tauri-apps/tauri/issues/8246`)
  * Tauri issue **#9220 "[bug] Flickering with raw display handle + winit + wgpu + tauri v2 + transparency"** — **closed as not planned**. `amrbashir`: "we are using GTK to create the window (which is basically an X11 window) and so it has its own drawing loop, when you add wgpu on top of it, they both fight on the same x11 surface hence the flickering, **we can't really do anything to fix this as we need to use GTK for webviews**… While possible to add a GTK widget as a child X11 window inside raw X11 window, this is however a bit hacky and **it is not possible on Wayland at all**… Can you draw OpenGL into GTK? yes you can combine `gtk::Fixed` a `gtk::GlArea` widget and then add the webview widgets on top of it. The only problem here is that you will do the drawing yourself." (`https://github.com/tauri-apps/tauri/issues/9220`)
  * tauri-apps discussion **#11944** contains the most detailed field notes. `jzade` (PSG-Team): "for us the Windows path needed **its own child HWND rather than deriving a surface from the webview's window handle**"; "The child window needs to be **click-through**, not just transparent, or input stops reaching the webview underneath"; "Keep the decoy surface empty… If you draw actual content there, you're back in the surface-contention fight with the webview that #9220 describes." `Abab-bk`: "Steam Overlay does not support Wayland. It works fine on X11, and XWayland is supported… Therefore, this is an unsolvable problem on Linux." (`https://github.com/orgs/tauri-apps/discussions/11944`)
* **What Tauri exposes for hosting native surfaces:**
  * `WebviewWindow::with_webview(|webview| …)` — the handle used by Harbor to reach `ICoreWebView2Controller2` and by Ventic-style code to reach the HWND.
  * `window.hwnd()` / `window.ns_window()` / `window.gtk_window()` / `window.default_vbox()` — reaching the platform window/container.
  * The `unstable` cargo feature: multi-webview / webview-less windows. Confirmed in the wild by `tauri-plugin-steam-overlay-surface` (`https://github.com/PSG-Team/tauri-steam-overlay-surface`, MIT), whose README says: "the plugin needs tauri's `unstable` feature (**windows without a webview**)" and which spawns "a transparent, click-through, borderless 'decoy' window … with a real swapchain presenting empty frames at vsync via wgpu."
  * Reference examples: `https://github.com/FabianLars/tauri-v2-wgpu` (a Tauri v2 + wgpu window; its README is just `# Tauri v2 + wgpu`), and `wry`'s GTK multi-webview example `https://github.com/tauri-apps/wry/blob/dev/examples/gtk_multiwebview.rs`.
* Tauri licensing: `Apache-2.0 OR MIT` (`https://raw.githubusercontent.com/tauri-apps/tauri/dev/Cargo.toml`, line 44; `LICENSE-APACHE-2.0` + `LICENSE-MIT` at repo root). GitHub API reports the repo as `Apache-2.0`.

### 3.2 Linux

* Tauri uses GTK3 + WebKitGTK (4.1) — a **GTK window**, and on X11 the webview is a widget drawn on the same X surface. That is the root of #9220's flicker.
* **The working shape** (per Tauri maintainers and per the parked Harbor fork) is `gtk::Overlay` containing a `gtk::GLArea` with the webview as `add_overlay`. That works on both X11 and Wayland in principle; the raw-X11-child trick does not work on Wayland at all.
* WebKitGTK transparency needs the accelerated compositor; `WEBKIT_DISABLE_COMPOSITING_MODE` must not be set (WebKit bug 192305, per the Harbor fork's comments) and the app needs an RGBA visual + `app-paintable`.
* Ventic dodges this entirely by forcing `GDK_BACKEND=x11` and using `--wid`.

---

## 4. egui + libmpv

* **egui backends.** `egui` 0.37.0 on crates.io (`https://crates.io/api/v1/crates/egui`; MIT OR Apache-2.0), and there are two official render backends: `egui_glow` (OpenGL) and `egui-wgpu` (wgpu). `eframe` can run either.
* **Third parties can blit an external GL texture / FBO into an egui frame.** Both mechanisms exist in the repos:
  * `egui_glow::Painter::register_native_texture(&mut self, native: glow::Texture) -> egui::TextureId` (`https://raw.githubusercontent.com/emilk/egui/main/crates/egui_glow/src/painter.rs`, line 649). Also `egui_glow::CallbackFn` (line 117) for arbitrary GL work inside the frame.
  * `egui-wgpu`: `pub trait CallbackTrait { fn prepare(...); fn finish_prepare(...); fn paint(...); }` and `Renderer::register_native_texture` / `update_texture` (`https://raw.githubusercontent.com/emilk/egui/main/crates/egui-wgpu/src/renderer.rs`, lines 88, 637, 809).
* **Existing crate that does exactly this for libmpv:** **`egui-sharkplayer`** — "A hardware accelerated video player for egui using libmpv", Unlicense, latest **0.5.1** (crates.io first published 2026-06-18), repo `https://codeberg.org/sharkyshark/egui-sharkplayer`, depends on `libmpv2 ^6.0` and `eframe ^0.35`. Its docs say verbatim: "The video player works best with the `glow` backend because **libmpv2's render API only supports OpenGL**. When using the `wgpu` feature, instead of a direct VRAM copy, image data has to roundtrip through main system memory. If at all possible, use `glow` and disable the `wgpu` feature." Note: 0.5.1, 318 downloads, 20.59% documented, docs.rs built for `x86_64-unknown-linux-gnu` only.
* **Rust libmpv crates and their render API coverage:**

| Crate | Version | License | Latest publish | Render API coverage |
|---|---|---|---|---|
| `libmpv2` | **6.0.0** | LGPL-2.1 | 2026-05-12 | Has a `render` module but **only OpenGL**. `pub enum RenderParamApiType { OpenGl }` — a single variant (`https://docs.rs/libmpv2/6.0.0/libmpv2/render/enum.RenderParamApiType.html`). `RenderParam` covers `Invalid, ApiType, InitParams, FBO, FlipY, Depth, ICCProfile, AmbientLight, X11Display, WaylandDisplay, AdvancedControl, NextFrameInfo, BlockForTargetTime, SkipRendering`. **No `sw`, no `d3d11`, no `Vulkan`.** |
| `libmpv2-sys` | 4.0.1 | LGPL-2.1 | 2025-12-29 | Raw bindgen; mirrors the C header, so `MPV_RENDER_API_TYPE_D3D11` would be present if built against a 0.42+ header, but the safe wrapper above does not expose it. |
| `libmpv` (ParadoxSpiral/libmpv-rs) | 2.0.1 | LGPL-2.1 | 2020-09-29 | Old; superseded. |
| `libmpv-rs` | **does not exist on crates.io** | — | — | `{"errors":[{"detail":"crate 'libmpv-rs' does not exist"}]}`. The repo `github.com/kohsine/libmpv-rs` publishes as `libmpv2`; `github.com/ParadoxSpiral/libmpv-rs` publishes as `libmpv`. |

* **No crate was found that provides a "video texture" abstraction over the D3D11 or SW render API.** `[inference]` Harbor's Windows path (Harbor `Cargo.toml`: `libmpv2 = "4"`, `libmpv2-sys = "4"`) sidesteps the crate's render module entirely by using `wid` on Windows and the render module only on macOS/Linux.

---

## 5. GPUI (Zed)

* **License split (verified):** the `gpui` crate is **Apache-2.0** on crates.io. Zed's app crates and its component library (`crates/ui`, `crates/ui_input`) are **GPL-3.0-or-later** and unpublished. Repo root has `LICENSE-APACHE` and `LICENSE-GPL`. Practical effect: the framework is permissive, the only first-party widget set is GPL.
* **crates.io status:** `gpui` **0.2.2**, published **2025-10-22**; prior 0.2.0/0.2.1 on 2025-10-09/14; the 0.1.0 was 2022-06-23. **No release since 2025-10-22** even though main has moved substantially (see below). 361,692 downloads. Repo: `https://github.com/zed-industries/zed`.
* **Platforms:** the 0.2.2 crate declares macOS (Metal, in-house renderer), Linux X11 + Wayland (blade-graphics 0.7 → **Vulkan**), and Windows (in-house Direct3D 11 + DXGI/DirectComposition, first-class since Zed's Windows GA on 2025-10-15). Windowing is **not winit**: AppKit/cocoa on macOS, in-house Wayland (wayland-client + calloop) and X11 (xcb) on Linux, raw Win32 via `windows-rs` on Windows.
* **On `main` since 0.2.2:** gpui was split into a crate family (`gpui`, `gpui_platform`, `gpui_macos`, `gpui_linux`, `gpui_windows`, `gpui_wgpu`, `gpui_web`, `scheduler`, …), **all Apache-2.0**, none published to crates.io; the Linux renderer was reimplemented on **wgpu** (PR #46758, merged 2026-02-13); **AccessKit** landed 2026-05-27 (PR #56065). None of that is in any release.
* **Docs quality:** docs.rs builds; `docs.rs/gpui` + 30 bundled examples in the published crate; two in-tree concept docs (`crates/gpui/docs/contexts.md`, `key_dispatch.md`); official site `gpui.rs` states "the best way to learn about these APIs is to read the Zed source code… or drop a question in the Zed Discord". No official book. Stability: README says "There will often be breaking changes between versions"; no changelog for gpui itself.
* **Can third parties draw custom GPU content / embed external textures?** The public API is `Element`/`Render` returning element trees; there is no first-party "external texture" or "native surface" element surfaced in the published crate. `[inference]` I found no documented public API in 0.2.2 for handing gpui an external GPU texture. What does exist:
  * **`gpui-component`** (`longbridge/gpui-kit`, Apache-2.0, **0.7.3**, 254,135 downloads) — 60+ widgets, the main permissive widget layer (Zed's own `ui` crate is GPL and unpublished).
  * **`gpui-video-player`** 0.1.2, **MIT**, 3,158 downloads, repo `https://github.com/cijiugechu/gpui-video-player` — "A video player library for gpui applications, **built on top of GStreamer**". So the one public GPUI video player is **not** libmpv.
* **Zed itself does play video?** Not verified either way; no evidence found of libmpv inside GPUI. Report §9.

---

## 6. Flutter + `media_kit`

* **Repo/license:** `https://github.com/media-kit/media-kit` — **MIT**, 1,842★, created 2022-02-23, last push 2026-08-30, "A cross-platform video player & audio player for Flutter & Dart."
* **Packages (pub.dev, read 2026-10-15):** `media_kit` 1.2.6 (2025-12-13), `media_kit_video` **2.0.1** (2025-12-02), `media_kit_libs_windows_video` 1.0.11, `media_kit_libs_linux` 1.2.1.
* **Platforms (README table):** Windows ✅ ("Windows 7 or above"), GNU/Linux ✅ ("Any modern GNU/Linux distribution"), plus macOS/iOS/Android; web is ✅ but **not via libmpv** ("On the web, **libmpv is not used**. Video & audio playback is handled by embedding HTML `<video>` element"). Hardware/GPU acceleration ✅ by default (`enableHardwareAcceleration: true`).
* **Does video render inside the Flutter window?** Yes, and it is documented with per-platform sequence diagrams. The README is explicit that this required a dedicated package: "no such 'event-polling' like API is possible for video rendering. So, [the] idea seemed to create a new package `package:media_kit_video` for specifically offering platform-specific video embedding implementation which internally handles **Flutter's Texture Registry API** & **libmpv's OpenGL rendering API**."
  * **Windows:** `VideoOutput` owns `mpv_handle*` + `mpv_render_context*` and an **`ANGLESurfaceManager`** ("Only for H/W accelerated rendering") that does `CreateEGLDisplay()` / `CreateD3DTexture()` / `CreateAndBindEGLSurface()`, holds `ID3D11Device`, `ID3D11DeviceContext`, an `ID3D11Texture2D` and an `EGLContext`, and exposes a `FlutterDesktopGpuSurfaceDescriptor`. Software path uses `FlutterDesktopPixelBuffer` instead.
  * **GNU/Linux:** `VideoOutput` holds a `GdkGLContext*`, `mpv_handle*`, `mpv_render_context*`, and a **`TextureGL`** implementing `FlTextureGL::texture_gl_populate_texture` (or `TextureSW` / `FlPixelBufferTexture` for software). Registered through `FlTextureRegistrar`.
  * **Android:** `--wid` on an `android.view.Surface` from Flutter's `SurfaceTextureEntry`, with `--hwdec=mediacodec`, `--vo=mediacodec_embed`, `--wid=(intptr_t)(*android.view.Surface)`.
  * **macOS:** "based on libmpv"; iOS uses OpenGL ES instead of OpenGL.
* **Conclusion it proves:** Flutter desktop + libmpv compositing with custom UI in one window is a shipped, documented design on both Windows (ANGLE/EGL + D3D11 texture → Flutter texture) and Linux (`GdkGLContext` + `FlTextureGL`). It is achieved via Flutter's texture registry, **not** by putting Flutter widgets over a foreign child window. `[inference]` this is the key architectural difference from Tauri: Flutter's compositor accepts an external GPU texture as a first-class citizen; WebView2/WebKitGTK do not.
* **Maturity caveats found in the README:** recommends `mimalloc` on Linux "for avoiding memory leaks" (links issue #68); `media_kit_native_event_loop` exists because of Dart FFI callback/deadlock issues (dart-lang/sdk#37022, #51254, #51261 — the README says the async-callback issue was resolved in Dart SDK 3.1.0 via `NativeCallable`); Linux uses system shared libraries ("`sudo apt install libmpv-dev mpv`", "**This is how GNU/Linux works**").

---

## 7. Qt / QML + libmpv

* **mpv's own source tree does NOT contain a QML example.** `find /tmp/opencode/mpv-master -iname '*.qml' -o -iname '*.pro' -o -iname '*.ui'` → empty. The examples live in the separate `mpv-player/mpv-examples` repo. (The user's belief that there is a QML example "in mpv's source" is true for the *examples* repo, not the mpv repo. I did not verify when/whether one was ever removed from mpv proper — see §9.)
* **`mpv-examples/libmpv/qml`** — `main.cpp`, `main.h`, `main.qml`, `mpvtest.pro`, `mpvtest.qrc`. It is the reference for QML + libmpv. Mechanism (`main.cpp`):
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
  Constructor does `mpv_set_option_string(mpv, "vo", "libmpv")` and `mpv::qt::set_option_variant(mpv, "hwdec", "auto")`. `createRenderer()` calls `window()->setPersistentOpenGLContext(true); window()->setPersistentSceneGraph(true);`. It also resets the locale: "Qt sets the locale in the QGuiApplication constructor, but libmpv requires the LC_NUMERIC category to be set to 'C', so change it back" — a real, documented Qt+libmpv gotcha. `main.qml` is the proof-of-concept for "**QtQuick and mpv are both rendering stuff**" with QML overlays (`MouseArea`, `Rectangle`, `Row`, `Slider`) drawn over the `MpvObject`.
* **`mpv-examples/libmpv/qt_opengl`** — the same idea in QOpenGLWidget (`mpvwidget.cpp`, `mainwindow.cpp`), described in the examples README as: "Since it does not rely on embedding 'foreign' native Windows, it's usually more robust, potentially faster, and it's easier to control how your GUI interacts with the video. **You can do your own OpenGL rendering on top of the video as well.**"
* **`mpv-examples/libmpv/qt`** — "Shows how to embed the mpv video window in Qt (using normal desktop widgets)" — i.e. `wid`, not the render API.
* **Is this officially documented?** The examples README is the only mpv-project documentation of Qt integration; `DOCS/man/libmpv.rst` only links to the examples tree. Stremio's shell is the largest real-world Qt+libmpv consumer I found, and its README does not document the mechanism (read from source, §2.3).

---

## 8. Licenses and the GPL/LGPL question

### 8.1 UI toolkits

| Toolkit | License | Source of truth |
|---|---|---|
| Tauri 2 | **`Apache-2.0 OR MIT`** | `crates/tauri/Cargo.toml` (`license.workspace = true`) → workspace `Cargo.toml` line 44: `license = "Apache-2.0 OR MIT"`; repo root has `LICENSE-APACHE-2.0`, `LICENSE-MIT`, `LICENSE.spdx`. GitHub API reports `Apache-2.0`. |
| egui / eframe | **MIT OR Apache-2.0** | crates.io `egui` 0.37.0 |
| GPUI | **Apache-2.0** (crate); Zed's `ui`/`ui_input` crates **GPL-3.0-or-later** and unpublished | crates.io `gpui` 0.2.2; `zed-industries/zed` `LICENSE-APACHE` / `LICENSE-GPL` |
| Qt | **Dual: LGPL-3.0 (primary OSS), GPL-3.0-only, GPL-2.0, or commercial.** Some modules are GPL-only. | `qt/qtbase/LICENSES/` contains `LGPL-3.0-only.txt`, `GPL-3.0-only.txt`, `GPL-2.0-only.txt`, `LGPL-2.1-or-later.txt`, `LicenseRef-Qt-Commercial.txt`, `Qt-GPL-exception-1.0.txt`; `https://www.qt.io/development/open-source-lgpl-obligations` |
| Flutter | **BSD-3-Clause** | GitHub API `flutter/flutter` |
| `media_kit` | **MIT** | GitHub API `media-kit/media-kit` |
| `libmpv2` crate | **LGPL-2.1** | crates.io |
| GPUI video (GStreamer) | MIT | crates.io `gpui-video-player` 0.1.2 |

Qt's own page states: "The primary open-source license is the GNU Lesser General Public License v. 3 ('LGPL'). With the LGPL license option, you can use the essential libraries and some add-on libraries of Qt. This allows for keeping your application source code closed as long as all the requirements of LGPLv3 are met… some parts of Qt are only provided under GPL for open source users." LGPL requirements listed there include: ship the complete corresponding source of the library (even unmodified), allow re-linking and reverse engineering, notify the user, and that "some means of distribution, such as online application stores, may have rules that are in conflict with LGPL". Note Qt's LGPLv3 requirements are **stricter than LGPLv2.1** (anti-tivoization / installation information, patent clauses).

### 8.2 mpv's own licensing and `-Dgpl=false`

`Copyright` (repo root, `https://raw.githubusercontent.com/mpv-player/mpv/master/Copyright`) is unambiguous:

> "mpv as a whole is licensed under the GNU General Public License GPL version 2 or later (called GPLv2+ in this document… by default. The mpv program is licensed the GNU Lesser General Public License LGPL version 2 or later (LGPLv2.1+)… if built without using any GPL only files. The `-Dgpl=false` configure switch is provided as a convenience for excluding the GPL only files listed below from the build process.
> **However, do note that the build system is provided 'as is' and using the `-Dgpl=false` configure switch does not in itself create a LGPLv2.1+ license grant.**"

`README.md` line 192: "GPLv2 'or later' by default, LGPLv2.1 'or later' with `-Dgpl=false`."

**The configure option is `gpl` in `meson.options`** (not `meson_options.txt`, which no longer exists; `meson_options.txt` on `master` → HTTP 404):
```
option('gpl', type: 'boolean', value: true, description: 'GPL (version 2 or later) build')
```

**What `-Dgpl=false` actually disables.** Two independent, verifiable lists:

*(a) The `Copyright` file's user-visible feature list:*
> "LGPL mode disables the following features, some of them quite central:
> - Linux X11 video output
> - BSD audio output via OSS
> - NVIDIA/Linux hardware decoding (vdpau, although nvdec usually works)
> - minor features: jack, DVD, CDDA, DVB, CACA, legacy direct3d VO
> Some of these will be fixed in the future. The intended use for LGPL mode is with libmpv, and currently **it's not recommended to build mpv CLI in LGPL mode at all.**"

*(b) The GPL-only source files, per `Copyright`:* `audio/out/ao_jack.c`, `audio/out/ao_oss.c`, `stream/dvb*`, `stream/stream_cdda.c`, `stream/stream_dvb.*`, `stream/stream_dvdnav.c`, `video/out/vo_caca.c`, `video/out/vo_direct3d.c`, `video/out/vo_vaapi.c`, `video/out/vo_vdpau.c`, `video/out/vo_x11.c`, `video/out/vo_xv.c`, `video/out/x11_common.*`, `video/vdpau.c`, `video/vdpau.h`, `video/vdpau_mixer.*`; plus non-program parts `DOCS/man/`, `etc/mplayer-input.conf`, `etc/mpv.desktop`, `etc/restore-old-bindings.conf`.

*(c) The build-system enforcement* (`meson.build` on `master`) — what is actually gated on `get_option('gpl')`:

| Feature | Gate | Lines |
|---|---|---|
| `cdda` (libcdio) | `get_option('cdda').require(get_option('gpl'), error_message: 'the build is not GPL!')` | 645–651 |
| `dvbin` (DVB) | same pattern | 657–663 |
| `dvda` (libdvdread) | same pattern | 668–676 |
| `dvdnav` | same pattern | 678–686 |
| `jack` | same pattern | 887–892 |
| `oss-audio` | same pattern | 925–931 |
| `caca` | same pattern | 978–984 |
| `direct3d` (`vo_direct3d.c`) | `.require(get_option('gpl') and features['win32-desktop'], error_message: 'the build is not GPL or this is not a win32 desktop!')` | 989–995 |
| `x11` (deps: x11, xscrnsaver, xext, xpresent, xrandr) | `get_option('x11').require(get_option('gpl'), ...)` | 1125–1134 |
| `gl-x11` (GLX context) | `get_option('gl-x11').require(GL.found() and gl_allowed and features['x11'], ...)` ⇒ **also disabled**, since `x11` is off | 1201–1210 |
| `vdpau` | `get_option('vdpau').require(features['x11'], ...)` ⇒ **also disabled** | 1532–1545 |

Note the ripple: because `x11` is itself GPL-gated, `gl-x11` (GLX) and `vdpau` fall away transitively even though they are not directly GPL-gated.

**Does an LGPL-mode libmpv still do hardware-accelerated rendering through the render API?** Yes, for the paths the design cares about:
* `video/out/libmpv_gpu.c`, `video/out/vo_libmpv.c`, `video/out/libmpv_sw.c`, `video/out/opengl/libmpv_gl.c` and `video/out/d3d11/libmpv_d3d11.c` contain **no `gpl` gating at all** (`grep -rn gpl` over those files returns nothing).
* `d3d11` (the video-out feature that builds `video/out/d3d11/context.c`, `ra_d3d11.c`, `libmpv_d3d11.c`) is `get_option('d3d11')` — **not GPL-gated** (meson.build line 1066). So the D3D11 render API would be available in LGPL mode.
* Windows hwdec `d3d11va` / `d3d11va-copy` (manual: "requires `--vo=gpu` or `--vo=gpu-next` with `--gpu-context=d3d11` or `--gpu-context=angle` (Windows 8+ only)") is unaffected.
* `--vo=libmpv` requires the `gpu`/`gpu-next` renderer, which needs `plain-gl`, `egl-*`, `d3d11`, or `vulkan`; all are non-GPL options.
* On Linux, LGPL mode loses `vo_x11`/`vo_xv`/GLX/vdpau. The available hardware paths are EGL (`egl-x11`, `egl-wayland`, `egl-drm`), the render API with `MPV_RENDER_PARAM_X11_DISPLAY`/`WL_DISPLAY`, VAAPI, DRM, and `nvdec` ("although nvdec usually works"). `[inference]` an LGPL build on X11 must be an EGL/GBM build, not GLX.
* `Copyright`'s closing caveat: "Linked libraries still can affect the final license (for example **if FFmpeg was built as GPL**)."

### 8.3 Windows prebuilt libmpv builds

* `https://mpv.io/installation/` lists Windows builds by **shinchiro** (`github.com/shinchiro/mpv-winbuild-cmake/releases`) and **zhongfly** (`github.com/zhongfly/mpv-winbuild/releases`), plus first-party GitHub CI builds (`releases/tag/git-release`), Scoop, Chocolatey, MSYS2, and calls the package situation out: "**All binary packages are unofficial third-party builds, except as noted.**"
* **The shinchiro builds (the ones Harbor's `setup-libmpv.ps1` downloads) are GPL builds.** Evidence in that repo's own build recipes:
  * `packages/ffmpeg.cmake` line 60: `--enable-gpl` ⇒ the bundled FFmpeg is GPL, which by mpv's own `Copyright` caveat governs the combined binary.
  * `packages/mpv.cmake` sets `-Dlibmpv=true`, `-Dvulkan=enabled`, `-Djavascript=enabled`, **`-Ddvdnav=enabled`**, `-Dlibbluray=enabled`, `-Dspirv-cross=enabled`, `-Dsixel=enabled` — and does **not** pass `-Dgpl=false`, so the meson default (`gpl = true`) applies; `-Ddvdnav=enabled` is itself a GPL-gated feature.
  * That same file also ships the dev header set: it copies `include/mpv/client.h`, `stream_cb.h`, `render.h`, `render_gl.h` into `mpv-dev/` — i.e. **`render_d3d11.h` is not in that dev bundle** (`[inference]` because the build predates the 0.42 API), which is consistent with `libmpv2`'s OpenGL-only `RenderApiType`.
  * `shinchiro/mpv-winbuild-cmake` declares **no license** in the GitHub API.
* `[inference]` No prebuilt LGPL-mode Windows libmpv was found in the sources I read; producing one would mean a custom build with `-Dgpl=false` **and** an LGPL/non-GPL FFmpeg.
* A concrete data point on the practical consequence: `docs/adr/0004-gpl3-with-stock-gpl-mpv.md` in this repo records that Harbor ships **MIT** while linking the stock GPL mpv, and that this project chose GPL-3.0-or-later instead. I verified Harbor's license is MIT (`9000000/harbor` and `MenotiFilho/harbor` both report `MIT`). mpv.net, by contrast, is GPL-2.0.

---

## 9. Could not verify / weak sources

1. **`/home/menotifilho/projetos/harbor` does not exist**, and `github.com/harborstremio/harbor` returns 404 on 2026-10-15. I could not read the exact tree the task names. All Harbor quotes come from `github.com/9000000/harbor@main` (the `source` of `MenotiFilho/harbor`), which is a real Tauri+libmpv+React Stremio client but appears to be an earlier/different revision (v0.8.5, no `librqbit`, no `harbor-core/`, no `stremio_auth.rs`, no `torrent_engine.rs`) than the 0.9.21 described in `/home/menotifilho/projetos/tarefasGerais/arquivos/pesquisa-harbor-stremio.md`.
2. **Whether `9000000/harbor` is a renamed `harborstremio/harbor`.** The fork metadata (`source: 9000000/harbor`, `parent: 3-pr/harbor`) is consistent with a rename, but the `harborstremio` user has 0 public repos, so I cannot confirm the lineage. Unverified.
3. **D3D11 render API release attribution.** `DOCS/client-api-changes.rst` files it under `--- mpv 0.42.0 ---` (unreleased), while `render_d3d11.h` says `Copyright (C) 2024` and the single commit on that path is dated 2026-04-17. I report both; I did not resolve the discrepancy. Consequently: **whether any shipped mpv binary today exposes `MPV_RENDER_API_TYPE_D3D11` — particularly the shinchiro `mpv-dev-x86_64-v3.zip` that Harbor downloads — was not verified by inspecting a binary.**
4. **The removal date of the QML example from mpv proper.** It is absent from `master` today (verified); I did not bisect the history to find when it moved to `mpv-examples`.
5. **GPUI external-texture / video support.** The GoldStrikeArch report `report/03-gpui.md` (July 2026) is a third-party audit, not Zed's own documentation; I used it for the platform/crate-split details and cross-checked the license and crates.io facts directly. I found **no** documented public API in gpui 0.2.2 for embedding an external GPU texture or native video surface, and no libmpv-in-GPUI project. `gpui-video-player` uses **GStreamer**, not libmpv. This is a gap in evidence, not a verified absence.
6. **Zed's own video playback mechanism** (if any) — not investigated.
7. **`mpv-easy/mpv-easy`'s role.** It is a TS/React toolkit for mpv *scripts* (no license file), not a host application; I verified the description and license status but did not read its source. The similarly-named `422658476/MPV-EASY-Player` (GPL-3.0, C#) is a different project I did not inspect.
8. **The `jzade`/`PSG-Team` overlay notes in Tauri discussion #11944** are forum comments, not documentation. They are detailed and internally consistent, and they match `tauri-plugin-steam-overlay-surface`'s README, but they are not authoritative. Treat the Windows "own child HWND is required" claim as reported, not proven.
9. **Tauri's `unstable` feature surface** was verified indirectly (maintainer statement in #8246, the `tauri-plugin-steam-overlay-surface` README's requirement "tauri = { version = \"2\", features = [\"unstable\"] }", and the wry `gtk_multiwebview.rs` example). I did not read Tauri's own docs page for multi-webview because none was found at `v2.tauri.app/learn/` on 2026-10-15.
10. **`media_kit`'s current Windows/ANGLE details** come from the README's mermaid class diagrams, which are self-reported and may lag the code. I did not read `media_kit_video`'s C++ sources.
11. **`[inference]` labels** in §1.4, §4, §6, §8.3 flag conclusions I drew rather than read verbatim.
12. **WordPress-style date skew.** Some sources in this environment carry dates that look shifted (e.g. mpv 0.42.0 unreleased while 2026-10-15 is "today"). I report source dates exactly as the sources state them.
