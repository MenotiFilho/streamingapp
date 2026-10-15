# Embedded libmpv: picture & audio quality consequences of the integration mechanism

**Date of research:** 2026-10-15. Every GitHub/raw/http read below was performed on this date.
**Scope:** verifiable facts only. No recommendations, no architecture advice. Inferences are labelled
`[inference]`. Things I could not confirm are in §9.

**Question answered:** for a viewer who cares that 4K HDR files do not stutter and are not degraded,
what does each embedding mechanism (`--wid` vs libmpv render API vs routing frames through a UI
compositor) do to the **media pipeline** — HDR/10-bit, hardware decode, frame pacing, audio, and
subtitles.

**Companion document:** `docs/research/libmpv-embedding-facts.md` (same repo) covers the rendering
*mechanics* of each mechanism (who owns the window, threading, licenses). This document covers the
*quality* consequences and cites that document only where I did not re-read the source myself; those
citations are marked as such.

---

## 0. Source status

Primary sources read for this document (raw files, not summaries):

| Source | Path / URL | Read |
|---|---|---|
| mpv option manual | `https://raw.githubusercontent.com/mpv-player/mpv/master/DOCS/man/options.rst` (402,731 bytes) | full text, quoted by section |
| mpv VO manual | `.../DOCS/man/vo.rst` | `--vo=libmpv`, `--vo=gpu-next` entries |
| mpv property manual | `.../DOCS/man/input.rst` | `sub-text`, `sub-*` entries |
| mpv render headers | `.../include/mpv/render.h`, `render_gl.h`, `render_d3d11.h` | full text |
| Flutter engine texture API | `.../flutter/engine/main/shell/platform/common/public/flutter_texture_registrar.h` | full text |
| Flutter engine Windows external texture | `.../flutter/engine/main/shell/platform/windows/external_texture_d3d.cc`, `external_texture.h` | full text |
| media_kit `main` | `media_kit_video/windows/{video_output.cc,angle_surface_manager.cc,angle_surface_manager.h}`, `media_kit_video/linux/{video_output.cc,texture_gl.cc}`, `media_kit/lib/src/player/native/player/real.dart`, `media_kit/lib/src/player/platform_player.dart`, `media_kit_video/lib/src/video_controller/platform_video_controller.dart`, `media_kit_video/lib/src/subtitle/subtitle_view.dart` | full text / quoted lines |
| Qt 6 | `qt/qtbase@dev src/opengl/qopenglframebufferobject.cpp`, `src/gui/rhi/qrhi.h`; `qt/qtdeclarative@dev src/quick/items/qquickframebufferobject.cpp` | full text / quoted |
| Stremio shell | `Stremio/stremio-shell@master` root: `mpv.cpp`, `main.cpp`, `stremio.pro` (files are at the repo root, not `src/`) | quoted lines |
| egui + libmpv | `codeberg.org/sharkyshark/egui-sharkplayer` @ `main`: `src/backend.rs`, `src/widget.rs`, `src/backend/wgpu_backend.rs` | quoted lines |
| Cove | `coveninja/cove@master`: `README.md`, `ARCHITECTURE.md` | quoted lines |

Issue-tracker reads used the GitHub search API and the public issue pages. Issue **numbers, titles,
dates and states** below are read from the GitHub API; where I quote a comment I say so.

---

## 1. The mechanisms, in terms of who owns the presentation target

This is the axis everything else hangs off.

**A. `--wid` embedding.** mpv creates its own window/VO inside the parent HWND/Window. mpv owns the
VO, the renderer **and the swapchain**. mpv's manual and `client.h` describe it as the *older* way
(quoted in the companion doc §1.7). On Windows this means mpv can pick `--gpu-context=d3d11`.

**B. The libmpv render API (`vo=libmpv`).** The API user owns the graphics context and passes a
target each frame: an FBO id for OpenGL (`mpv_opengl_fbo`), an `ID3D11Texture2D` for D3D11
(`mpv_d3d11_fbo`), or a CPU buffer for SW. There are exactly three API types —
`MPV_RENDER_API_TYPE_D3D11`, `_OPENGL`, `_SW` (`render.h:481` shows the D3D11 macro; the full set is
listed in `render.h`'s "Supported backends" block, per the companion doc §1.1). **mpv does not own
the swapchain** in this mode; the API user presents.

**C. Compositor-mediated texture.** The render API output is then handed to a UI toolkit's compositor
as a texture (Flutter texture registry, Qt `QQuickFramebufferObject`, an egui `TextureId`, a
Compose/Skia surface). The compositor's pixel format becomes a hard ceiling on what leaves mpv.

Mechanism C is what the quality questions are about: A keeps mpv's own pipeline end-to-end;
B+C replaces the *final* stage with whatever the toolkit can carry.

---

## 2. HDR / 10-bit / wide color

### 2.1 What mpv itself requires for HDR passthrough

Verbatim from `DOCS/man/options.rst`:

* `--target-colorspace-hint=<auto|yes|no>`: "When enabled, output colorspace metadata will be set on
  the swapchain depending on the GPU context and platform this may affect compositor/display. This
  can be used for 'HDR passthrough' and to set the output colorspace for SDR content. … **Currently,
  this is supported on Wayland, D3D11 and winvk contexts.** … **Requires a supporting driver and
  `--vo=gpu-next`.** (Default: `auto`)"
* `--target-colorspace-hint-mode=<target|source|source-dynamic>`: `source` is "the traditional 'HDR
  passthrough' mode (SDR too)". Default is `target`. "``--target-*`` options override the metadata
  in both modes." And: "**The ICC profile always takes precedence over any metadata.**"
* `--target-colorspace-hint-strict` (default enabled): "the configured swapchain colorspace (with the
  hint) will be respected … the negotiated swapchain format is used for rendering output."
* `--d3d11-output-format=<auto|rgba8|bgra8|rgb10_a2|rgba16f>`: "`auto` … will pick either rgba8 or
  rgb10_a2 depending on the configured desktop bit depth." And: "For `--vo=gpu-next`, `rgba16f`
  enables scRGB output."
* `--d3d11-output-csp=<auto|srgb|linear|pq|bt.2020>`: "Values other than 'srgb' and 'pq' have had
  issues in testing".
* `--fbo-format`: "Default: `auto`, which first attempts to utilize 16bit float (rgba16f, rgba16hf),
  and falls back to rgba16 if those are not available. Finally, attempts to utilize rgb10_a2 or rgba8
  if all of the previous formats are not available."
* `--icc-profile-auto`: "**Applications using libmpv with the render API need to provide the ICC
  profile via `MPV_RENDER_PARAM_ICC_PROFILE`.**"
* `--vo=gpu-next` is "the recommended output driver … which is the default" (`vo.rst`).

Three facts follow directly from these (each stated by the manual, not inferred):

1. `--target-colorspace-hint` is a **swapchain** feature that mpv can only apply where *it* owns the
   swapchain on a supported context (Wayland / D3D11 / winvk).
2. It requires `--vo=gpu-next`.
3. Under the render API, the output texture format is **chosen by the API user**, not by mpv
   (`mpv_opengl_fbo.internal_format`, `mpv_d3d11_fbo` format list).

### 2.2 `--wid`: mpv owns the swapchain

Under `--wid`, mpv is a normal VO (`gpu-next` by default, `gpu-context=d3d11` selectable on Windows).
That means, on Windows:

* `--target-colorspace-hint` is in its supported-context list ("D3D11 and winvk contexts") and its
  requirement (`--vo=gpu-next`) is met by the default.
* The output format is mpv's own choice: `--d3d11-output-format=auto` → `rgba8` or `rgb10_a2`
  depending on desktop bit depth, `rgba16f` (scRGB) selectable.
* `d3d11va` decode requires "`--vo=gpu` or `--vo=gpu-next` with `--gpu-context=d3d11` or
  `--gpu-context=angle`" — satisfied.

Stremio's own Windows shell (`Stremio/stremio-shell-ng`, Rust + WebView2) is the concrete instance:
per the companion doc §2.3 it sets `wid`, `hwdec=auto`, `vo=gpu-next,gpu,`, `gpu-context=d3d11`,
`d3d11-output-format=auto`, `d3d11-output-csp=auto`, `target-colorspace-hint=auto`,
`tone-mapping=bt.2390`. Its README states the rationale as HW acceleration rather than colours.
Issue `Stremio/stremio-shell-ng#73`, "Player: switch to vo=gpu-next and add HDR/SDR quality
defaults", 2026-05-10, **closed** — evidence the HDR defaults were added on purpose on the `wid`
path.

### 2.3 The render API: what changes for 10-bit and HDR

**The format handed to mpv is the API user's choice, and the API user's ceiling.**

* OpenGL: `mpv_opengl_fbo{int fbo; int w, h; int internal_format;}` — `internal_format` is
  "Underlying texture internal format (e.g. `GL_RGBA8`), or 0 if unknown" (`render_gl.h`). Nothing in
  the header forces 8-bit; a client *can* pass a 16-bit-float FBO.
* D3D11: `render_d3d11.h` supports `DXGI_FORMAT_B8G8R8A8_UNORM`, `R8G8B8A8_UNORM`,
  `R10G10B10A2_UNORM`, `R16G16B16A16_FLOAT`. **"sRGB formats are not supported."** The texture must
  be 2D, `D3D11_BIND_RENDER_TARGET`, `D3D11_USAGE_DEFAULT`, not multisampled, not an array, not
  mipmapped. The caller owns it and presents it.
* **Both D3D11 and the render API are unreleased as of 2026-10-15.** Per the companion doc §1.2
  (which read `DOCS/client-api-changes.rst`), `MPV_RENDER_API_TYPE_D3D11`,
  `MPV_RENDER_PARAM_D3D11_INIT_PARAMS` and `MPV_RENDER_PARAM_D3D11_FBO` are filed under
  `--- mpv 0.42.0 ---`, and the last tagged release is v0.41.0. The one commit on
  `include/mpv/render_d3d11.h` is `4255130de4`, dated 2026-04-17, "libmpv: add D3D11 render API
  backend" (companion doc §1.2).

**The render API does not run libplacebo.** `vo_libmpv`'s render backend is `gpu` (the legacy
renderer); `gpu-next` is only a *proposal*:

* mpv issue **#10810**, "Support for libplacebo (gpu-next) in the rendering API", opened
  **2022-10-29**, still **open**.
* mpv PR **#16818** (not a merged commit), "vo_libmpv: introduce 'gpu-next' render backend", opened
  **2025-09-20**, **draft**, milestone `v0.42.0` **removed 2026-01-23**. Its own description: "The
  new backend is built entirely on top of libplacebo, offloading all complex rendering tasks like
  scaling, colorspace conversion, OSD, and tone-mapping to it. This aligns the render API with the
  core mpv rendering architecture… libmpv clients can pass the `MPV_RENDER_PARAM_BACKEND` parameter
  with the value `gpu-next`". It is marked "Resolves: #15107 #10810".
* mpv PR **#18607**, "[RFC] vo_libmpv: add gpu-next OpenGL render API", opened **2026-10-13**
  (two days before this document) — i.e. the work is still arriving.
* mpv issue **#15107**, "HDR screenshots are unimplemented (gpu/gpu-next)", **2024-10-16**, open.

**Concrete downstream consequence claimed in code**, from the commit message of
`igeekfeng/LumaPlayer@c2e29fdef8a6ae0fbcdf588d603d9b9e4ece149c` (2026-10-08):
"mpv 的 legacy gpu 渲染器不处理 DV 的 RPU,Profile 5 片源会发紫发绿。gpu-next(libplacebo)能正确重整形,但进
render API 需要上游未合并的 mpv-player/mpv#16818" — *the legacy `gpu` renderer does not process the
Dolby Vision RPU, so Profile 5 sources come out purple/green; `gpu-next` (libplacebo) reshapes
correctly, but entering the render API requires the unmerged #16818.* (Third-party commit message;
labelled as reported.)

`[inference]` Therefore, on the render API as it exists in a released mpv, HDR content is handled by
the legacy `gpu` renderer path: no libplacebo dynamic per-scene metadata handling, no
`--target-colorspace-hint` swapchain negotiation (the caller owns the swapchain), and the output
bit depth is whatever texture format the client chose. This is consistent with the manual's two
independent requirements (swapchain + `--vo=gpu-next`) and with PR #16818's existence, but the
manual never says "HDR is unsupported via the render API" in one sentence.

**`MPV_RENDER_PARAM_ICC_PROFILE` is the render API's substitute for `--icc-profile-auto`** (manual,
quoted in §2.1). If a client does not pass one and relies on `icc-profile-auto`, the sink-side colour
management is missing. `[inference]`.

### 2.4 Flutter texture registry / `media_kit_video`

**The pixel format Flutter accepts is 8-bit only.** Flutter's own C header,
`shell/platform/common/public/flutter_texture_registrar.h` (engine `main`), defines **exactly two**
pixel formats for GPU surfaces:

```c
typedef enum {
  kFlutterDesktopPixelFormatNone,
  // Represents a 32-bit RGBA color format with 8 bits each for red, green, blue and alpha.
  kFlutterDesktopPixelFormatRGBA8888,
  // Represents a 32-bit BGRA color format with 8 bits each for blue, green, red and alpha.
  kFlutterDesktopPixelFormatBGRA8888
} FlutterDesktopPixelFormat;
```

There is no 10-bit, 16-bit or HDR entry. The surface types are
`kFlutterDesktopGpuSurfaceTypeNone`, `...DxgiSharedHandle`, `...D3d11Texture2D`.

**Flutter's Windows ingest path is `GL_RGBA8_OES`.** `shell/platform/windows/external_texture_d3d.cc`:

```cpp
opengl_texture->format = GL_RGBA8_OES;
...
EGL_TEXTURE_FORMAT, EGL_TEXTURE_RGBA,  // always EGL_TEXTURE_RGBA
```

**`media_kit_video` on Windows produces exactly `B8G8R8A8_UNORM` and declares `BGRA8888`.**
`media_kit_video/windows/angle_surface_manager.cc`:

```cpp
d3d11_texture2D_desc.Format = DXGI_FORMAT_B8G8R8A8_UNORM;
d3d11_texture2D_desc.BindFlags = D3D11_BIND_RENDER_TARGET | D3D11_BIND_SHADER_RESOURCE;
```
and `video_output.cc`:
```cpp
texture->format = kFlutterDesktopPixelFormatBGRA8888;
```
The D3D11 texture is exposed to ANGLE as an EGL pbuffer
(`eglCreatePbufferFromClientBuffer(..., EGL_D3D_TEXTURE_2D_SHARE_HANDLE_ANGLE, ...)` with
`EGL_TEXTURE_FORMAT, EGL_TEXTURE_RGBA`), and mpv renders into FBO 0 of that surface.

**`media_kit_video` on Linux is `GL_RGBA` / `GL_UNSIGNED_BYTE`.** `media_kit_video/linux/texture_gl.cc`:

```c
glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, required_width, required_height,
             0, GL_RGBA, GL_UNSIGNED_BYTE, NULL);
...
mpv_opengl_fbo fbo{(gint32)self->fbo, required_width, required_height, 0};
```
The frame is then shared to Flutter's context through an `EGLImage`
(`eglCreateImageKHR(..., EGL_GL_TEXTURE_2D_KHR, ...)` + `glEGLImageTargetTexture2DOES`).

**Software fallback is worse:** Windows and Linux both use `MPV_RENDER_PARAM_SW_FORMAT, "rgb0"` (32-bit,
8 bits per channel, CPU-side). Windows additionally caps software rendering at 1080p:
`#define SW_RENDERING_MAX_HEIGHT 1080` in `media_kit_video/windows/video_output.cc`.

**Defaults that degrade picture quality regardless of HDR.** `media_kit/lib/src/player/native/player/real.dart`
sets these unconditionally on every platform (lines 2459–2486), with the source comments listing them
as deliberate defaults:

```
'scale': 'bilinear',
'dscale': 'bilinear',
'dither': 'no',
'correct-downscaling': 'no',
'linear-downscaling': 'no',
'sigmoid-upscaling': 'no',
'hdr-compute-peak': 'no',
```

`dither=no` is mpv's "enable dithering" switch; `scale`/`dscale=bilinear` are mpv's cheapest scalers.
These are hardcoded in the property map, not exposed on `PlayerConfiguration` (whose fields are: `vo`,
`osc`, `pitch`, `title`, `ready`, `muted`, `async`, `libass`, `libassAndroidFont`,
`libassAndroidFontName`, `logLevel`, `bufferSize`, `protocolWhitelist`, `iosManageAudioSession`
— `platform_player.dart:439–560`). `[inference]` they cannot be overridden by a `media_kit` consumer
except by mutating properties after player creation.

**Defaults about VO and hwdec.** `media_kit_video/lib/src/video_controller/platform_video_controller.dart`
documents `VideoControllerConfiguration`:

* `vo` — "Default: Platform specific. Windows, GNU/Linux, macOS & iOS: `libmpv`. Android: `gpu`."
* `hwdec` — "Default: Platform specific. Windows, GNU/Linux, macOS & iOS: `auto`. Android:
  `auto-safe`."

So the shipped desktop default on Windows/Linux/macOS/iOS is **the render API** (`vo=libmpv`).

**Upstream statements on the tracker.**

* media-kit issue **#615**, "Video Player HDR Problem", opened **2023-11-22**, **open**, 26 comments.
  Contributor `23doors` (2023-11-22): "media_kit uses mpv and flutter textures. **Flutter textures
  don't have HDR capability on any platform.** So HDR needs to be tone mapped to SDR. Which different
  players handle differently… **actual HDR passthrough (to leverage actual HDR displays and use high
  nits values) is currently not possible with flutter textures at all** (at least on iOS, Android and
  Mac, dunno about Windows situation)." Maintainer `alexmercerind` (same day): "Yes, texture support
  in Flutter is also a limiting factor."
* Same issue, 2024-10-07: enabling `vo: 'gpu-next'` "only works on Android right now"
  (`alexmercerind`), via `VideoControllerConfiguration`; `SmartVive` reported success after updating
  libplacebo (2024-10-09).
* Same issue, 2025-05-24: `Predidit` (maintainer) shipped a PlatformView-based Android branch and
  wrote: "it **at least resolves the issue where Texture components don't support HDR at all**",
  adding "HDR still doesn't seem to be enabled."
* media-kit issue **#1207**, "Video playback in HDR10 format is abnormal.", **2025-06-23**, open.
* media-kit issue **#1354**, "How to correct color display of Dolby Profile5 video?", **2025-12-22**,
  open, 4 comments. (This issue is cross-referenced from mpv PR #16818's timeline, 2025-12-24.)

**Flutter-side tracker.** Flutter's wide-gamut work is happening in the **Flutter GPU** (Metal)
subsystem, not in the platform-texture path: `flutter/flutter#194156` "[Flutter GPU] GpuContext.
defaultColorFormat returns PixelFormat.unknown with wide gamut on Metal" and `#194166`
"[Flutter GPU] defaultColorFormat stays usable with wide gamut on Metal", both **2026-10-11**, open.
For platform textures the relevant history is: **#121046** "Windows Gpu Texture support for direct
usage of DirectX11 Texture2D" (2023-02-18, closed), **#154716** "Windows GPU memory leaks when
changing `handle` of `FlutterDesktopGpuSurfaceDescriptor`" (2024-09-06, **open**), **#190774**
"[Windows][Impeller] Snapshotting a GPU-surface external texture calls ResolveTextureSkia and
crashes in GrDirectContext::flush" (2026-08-08, closed), and **#181136** "feat: add
`Image.fromTextureId()` for zero-copy image creation from platform textures" (2026-01-19, **open**).

### 2.5 Qt / `QQuickFramebufferObject` + libmpv (Stremio shell)

**`QQuickFramebufferObject` forces Qt Quick onto OpenGL.** From
`qt/qtdeclarative@dev src/quick/items/qquickframebufferobject.cpp` (class docs):

> `\warning This class is only functional when Qt Quick is rendering via OpenGL. It is not compatible
> with other graphics APIs, such as Vulkan or [continues: Metal/D3D11]`

**The FBO it hands to mpv defaults to `GL_RGBA8`.** `createFramebufferObject` default implementation
is `return new QOpenGLFramebufferObject(size);` (same file). In
`qt/qtbase@dev src/opengl/qopenglframebufferobject.cpp`:

```cpp
static inline GLenum effectiveInternalFormat(GLenum internalFormat) {
    if (!internalFormat) {
        internalFormat = QOpenGLContext::currentContext()->isOpenGLES() ? GL_RGBA : GL_RGBA8;
    }
    return internalFormat;
}
```
and the docs: "The default internal texture format is `GL_RGBA8` for desktop OpenGL systems, and
`GL_RGBA` on [ES]".

Stremio's shell passes **`internal_format = 0`**:
`mpv_opengl_fbo mpfbo{static_cast<int>(fbo->handle()), fbo->width(), fbo->height(), 0};`
(`Stremio/stremio-shell@master mpv.cpp`). mpv's manual for `mpv_opengl_fbo.internal_format` says 0
means "unknown".

**Stremio additionally forces the ANGLE/D3D9 path on Windows.** `Stremio/stremio-shell@master main.cpp`:

```cpp
// Default to ANGLE (DirectX), because that seems to eliminate so many issues on Windows
Application::setAttribute(Qt::AA_UseOpenGLES);
qputenv("QT_ANGLE_PLATFORM", "d3d9");
```
So on Windows the render API's GL context is ANGLE with the **Direct3D 9** backend, and
`isOpenGLES()` is true → the FBO internal format is `GL_RGBA` (8-bit). `mpv.cpp` also has a
commented-out `//mpv::qt::set_property(mpv, "opengl-backend", "angle");` and sets
`vo=libmpv`, `gpu-hwdec-interop=auto`, `audio-fallback-to-null=yes`.

**No HDR options exist anywhere in the shell.** Grepping `Stremio/stremio-shell@master` for
`target-colorspace-hint`, `d3d11-output-format`, `d3d11-output-csp`, `tone-mapping`, `hdr-compute-peak`,
`target-trc`, `target-prim` returns nothing in `mpv.cpp`, `main.cpp` or `stremio.pro`.
`stremio.pro` declares `QT += qml quick network … widgets webengine webchannel dbus` (Qt 5).

**Qt's own HDR plumbing is RHI-side and therefore unreachable from a `QQuickFramebufferObject` path.**
`qt/qtbase@dev src/gui/rhi/qrhi.h`:

```cpp
struct QRhiSwapChainHdrInfo { enum LimitsType {…}; enum LuminanceBehavior {…}; … float sdrWhiteLevel; };
class QRhiSwapChain { enum Format { SDR, HDRExtendedSrgbLinear, HDR10, HDRExtendedDisplayP3Linear }; …
                       virtual QRhiSwapChainHdrInfo hdrInfo(); };
enum QRhiTexture::Format { …, RGBA16F, … };
```
`QQuickFramebufferObject` is documented as OpenGL-only, so `QRhiSwapChain::setFormat(HDR10)` and
`hdrInfo()` are not part of the render path Stremio uses. `[inference]` the shell's mpv output is
therefore an 8-bit `GL_RGBA` FBO inside Qt Quick's OpenGL pipeline, and HDR must be tone-mapped by
mpv before it lands there.

**Shell-side complaints on the tracker** (all read from the GitHub API):

| Issue | Title | Opened | State |
|---|---|---|---|
| `Stremio/stremio-shell#494` | "Add toggle in settings for older processors getting hammered by the new MPV renderer." | 2026-07-06 | open |
| `Stremio/stremio-shell#441` | "QT6 / mpv update" | 2025-06-23 | open, 11 comments |
| `Stremio/stremio-shell#144` | "Stuttering on 144HZ displays when using full screen mode." | 2020-06-29 | open |
| `Stremio/stremio-shell#425` | "Upscalers support" | 2024-12-12 | closed |
| `Stremio/stremio-shell-ng#73` | "Player: switch to vo=gpu-next and add HDR/SDR quality defaults" | 2026-05-10 | closed |
| `Stremio/stremio-shell-ng#43` | "Player: allow setting mpv vf property for RTX Auto HDR / VSR support" | 2026-05-02 | closed |

And the shell-ng README's own contrast (per companion doc §2.3): Qt's "complex rendering pipeline
involving ANGLE and multiple levels of composing and drawing to textures … inhibits full HW
acceleration", whereas the `wid` + `d3d11` path "allows full HW acceleration".

### 2.6 egui + `libmpv2` (glow)

`codeberg.org/sharkyshark/egui-sharkplayer@main src/backend.rs` — this is the concrete egui+libmpv
implementation, and it is explicit about both the format and what it does with HDR:

```rust
#[error("Incomplete framebuffer (0x{0:x}); Ensure RGBA8 support.")]
...
/// Allocate an RGBA8 texture and framebuffer.
glow::TEXTURE_2D, ..., glow::RGBA8.cast_signed(), ...
...
mpv.set_property("hwdec", "auto-safe")?;
// Support HDR video
mpv.set_property("tone-mapping", "auto")?;
mpv.set_property("video-timing-offset", 0.0_f64)?;
...
RenderParam::ApiType(RenderParamApiType::OpenGl),
RenderParam::InitParams(OpenGLInitParams { ... }),
...
self.mpv.ctx.render::<()>(fb, size.width, size.height, true)?;
```

So: **RGBA8 FBO**, libmpv2's OpenGL-only render API, and the comment "Support HDR video" sits directly
above a **`tone-mapping`** assignment — i.e. HDR is converted, not passed through. No
`MPV_RENDER_PARAM_ADVANCED_CONTROL`, no `MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME`, and no
`mpv_render_context_report_swap()` appear anywhere in `backend.rs`, `widget.rs` or
`backend/wgpu_backend.rs`.

`libmpv2` (the crate both egui-sharkplayer and the parked Harbor fork use) exposes
`pub enum RenderParamApiType { OpenGl }` — one variant (companion doc §4, read from docs.rs for
libmpv2 6.0.0). The `wgpu` feature of egui-sharkplayer does not change the format; it adds a
GPU→CPU→GPU round trip (its own docs, quoted in companion doc §1.4/§4).

### 2.7 Compose Multiplatform / Skia (Cove)

`coveninja/cove` exists: `github.com/coveninja/cove`, **AGPL-3.0**, Kotlin Multiplatform / Compose
Multiplatform, targets Linux, Windows, macOS and Android phone/tablet/TV (`README.md`).
`README.md`: "**libmpv provides the playback boundary on both shipping hosts**".
`ARCHITECTURE.md`:

> "`app/desktop` | Desktop composition root, lifecycle, packaging, and mpv surfaces"
> "Desktop mpv stays in-process through JNA. **The OpenGL path retains GPU rendering and hardware
> decoding; software rendering remains the controlled fallback.**"
> "Android uses its native libmpv surface host, a media-playback foreground service…"

I did **not** read Cove's Kotlin/Java source, so I cannot state the Skia-side pixel format, whether it
uses `--wid` or the render API on desktop, or whether HDR survives. See §9. The only Cove
issue in the colour/stutter search space is **#86**, "Fix desktop video portability and Flatpak
decoder support", **2026-10-09**, open.

### 2.8 Summary table (HDR / 10-bit)

| Mechanism | Who owns the swapchain | Path mpv is on | Output bit depth actually reached | `--target-colorspace-hint` | Evidence |
|---|---|---|---|---|---|
| `--wid` (`gpu-next` + `gpu-context=d3d11`) | mpv | full `vo=gpu-next`/libplacebo | mpv's choice: `rgba8` **or** `rgb10_a2`/`rgba16f` (`--d3d11-output-format`) | supported context per manual ("D3D11 and winvk") | options.rst; shell-ng player.rs (companion doc §2.3) |
| Render API, OpenGL | caller | legacy `gpu` render backend (`gpu-next` unmerged: PR #16818) | caller's `internal_format`; **Windows requires ANGLE** (`render_gl.h`) | not available (mpv does not own the swapchain; manual lists only Wayland/D3D11/winvk) | render.h, render_gl.h, PR #16818, #10810 |
| Render API, D3D11 | caller | legacy `gpu` + d3d11 backend | caller's texture format; `R10G10B10A2_UNORM`/`R16G16B16A16_FLOAT` allowed, **sRGB not supported** | not available; API itself is unreleased (mpv 0.42.0) | render_d3d11.h; companion doc §1.2 |
| `media_kit_video` Windows (Flutter) | Flutter/ANGLE | render API → EGL pbuffer on a D3D11 texture | **`DXGI_FORMAT_B8G8R8A8_UNORM` → `kFlutterDesktopPixelFormatBGRA8888` → `GL_RGBA8_OES`** | no | angle_surface_manager.cc, video_output.cc, external_texture_d3d.cc, flutter_texture_registrar.h |
| `media_kit_video` Linux (Flutter) | Flutter/EGL | render API → GL FBO → EGLImage | **`GL_RGBA` / `GL_UNSIGNED_BYTE`** (8-bit) | no | texture_gl.cc |
| Qt `QQuickFramebufferObject` (Stremio shell) | Qt Quick / OpenGL | render API, `vo=libmpv` | **`GL_RGBA8`** (desktop GL) / **`GL_RGBA`** (ANGLE ES path Stremio forces) | no | qquickframebufferobject.cpp, qopenglframebufferobject.cpp, stremio-shell mpv.cpp/main.cpp |
| egui + libmpv2 (glow) | egui/glow | render API | **`RGBA8`**, and the code tone-maps (`tone-mapping=auto`) | no | egui-sharkplayer backend.rs |
| Cove (Compose/Skia) | not determined | "in-process through JNA", "OpenGL path" | **could not verify** | not determined | cove ARCHITECTURE.md |

---

## 3. Hardware decoding / zero-copy

### 3.1 What mpv requires

From `DOCS/man/options.rst`:

* `d3d11va` "requires `--vo=gpu` or `--vo=gpu-next` with `--gpu-context=d3d11` or
  `--gpu-context=angle` (Windows 8+ only)"; `d3d11va-copy` "copies video back to system RAM".
* `videotoolbox` requires `--vo=gpu`/`gpu-next`, **or `--vo=libmpv` (iOS 9.0 and up)**;
  `videotoolbox-copy` copies back.
* `vaapi` requires `--vo=gpu`, `--vo=gpu-next`, `--vo=vaapi` or `--vo=dmabuf-wayland`.
* `vulkan` hwdec "requires `--vo=gpu-next`" — i.e. Vulkan Video decode is not available on the legacy
  `gpu` renderer that the render API uses.
* `--gpu-hwdec-interop`: "for `libmpv`, which has no on-demand loading, this is equivalent to `all`."
* `--vd-lavc-dr=<auto|yes|no>`: direct rendering "works only with the following VOs: `gpu`: requires
  at least OpenGL 4.4 or Vulkan. `libmpv`: **The libmpv render API has optional support.**" And:
  "Using video filters of any kind that write to the image data … will silently disable the DR code
  path."
* `--hwdec-extra-frames`, `--hwdec-image-format`, `--d3d11va-zero-copy` (see §6 of the sibling doc for
  the last one).
* `--d3d11-adapter`: "Hardware decoders utilizing the D3D11 rendering abstraction's helper
  functionality to receive a device, such as D3D11VA or DXVA2's DXGI mode, will be affected by this
  choice."

From `render.h`, `MPV_RENDER_PARAM_ADVANCED_CONTROL` (verbatim):

> "In general, setting this option will enable the following features (and possibly more):
> — **'Direct rendering', which means the player decodes directly to a texture, which saves a copy per
> video frame ('vd-lavc-dr' option needs to be enabled, and the rendering backend as well as the
> underlying GPU API/driver needs to have support for it).**
> — Rendering screenshots with the GPU API if supported by the backend (instead of using a suboptimal
> software fallback via libswscale)."

`mpv_render_context_update()`: "optional if `MPV_RENDER_PARAM_ADVANCED_CONTROL` was not set
(default). … **If `MPV_RENDER_PARAM_ADVANCED_CONTROL` was set, this will do additional work such as
allocating textures for the video decoder.**"

`render_gl.h`: "Hardware decoding via this API is **fully supported**, but requires some additional
setup. (At least if direct hardware decoding modes are wanted, instead of **copying back surface data
from GPU to CPU RAM**.)" Plus the per-platform requirements: **"Windows: ANGLE is required (although
in theory GL/DX interop could be used)"**; Intel/Linux EGL + `MPV_RENDER_PARAM_X11_DISPLAY` /
`MPV_RENDER_PARAM_WL_DISPLAY`; nVidia/Linux GLX *and* EGL; macOS CGL; iOS EAGL.

`render_d3d11.h`: "d3d11va decodes on the device passed in `mpv_d3d11_init_params` from mpv's decoder
thread, and mpv enables multithread protection on the device for it. **A device created with
`D3D11_CREATE_DEVICE_SINGLETHREADED` does not support this, so only copy-back hardware decoding like
`d3d11va-copy` works with it.**"

So, verifiably:

* **Zero-copy through the render API is possible but conditional**: it requires
  `MPV_RENDER_PARAM_ADVANCED_CONTROL` **and** `vd-lavc-dr=yes` **and** backend/driver support
  (render.h), and on Windows it requires the OpenGL path to be ANGLE (render_gl.h). The D3D11 backend
  requires a non-singlethreaded device and a caller-owned texture that mpv draws into with the
  immediate context.
* **No copy-back is forced by the mechanism itself.** Nothing in the render API docs forces
  `*-copy`. `hwdec=videotoolbox-copy` / `d3d11va-copy` are *client choices*, not requirements —
  except: on a `D3D11_CREATE_DEVICE_SINGLETHREADED` device, `d3d11va-copy` is the only option
  (render_d3d11.h).
* **A compositor in the middle adds at least one GPU→GPU (or GPU→CPU) copy that mpv cannot remove.**
  `[inference]` — but the concrete instances are visible in code:
  * `media_kit_video` Windows renders mpv into the EGL/pbuffer surface, then does
    `d3d_11_device_context_->CopyResource(d3d_11_texture_2D_.Get(), internal_d3d_11_texture_2D_.Get());`
    once per presented frame, then hands the second texture to Flutter.
    (`angle_surface_manager.cc`, and the code comment says exactly why: to prevent
    feedback/concurrency issues.)
  * `media_kit_video` Linux creates the `EGLImage` from mpv's texture and imports it into Flutter's
    context — a zero-copy *share*, but Flutter then samples it into Skia/Impeller's own target.
  * Windows software path: `SW_RENDERING_MAX_HEIGHT 1080` and CPU pixels, i.e. full copy-back plus a
    1080p cap.
* **`hwdec` defaults per mechanism:** media_kit desktop `auto`, Android `auto-safe`
  (`VideoControllerConfiguration` docs). The parked Harbor fork's macOS path set
  `hwdec=videotoolbox-copy` (companion doc §2.1b — that is the *render API* path; `videotoolbox` is
  only allowed with `--vo=libmpv` on iOS, so on macOS the copy variant is the supported one under the
  render API). `egui-sharkplayer` sets `hwdec=auto-safe`.

**Concrete zero-copy breakage reports** (title/date/state from the GitHub API):

| Issue | Title | Opened | State |
|---|---|---|---|
| media-kit `#1323` | "Android devices experiencing stuttering and frame drops when playing 4K HEVC 10-bit 120fps videos at double speed." | 2025-11-14 | open |
| media-kit `#1463` | "[Linux/Wayland] Video stays black although the GL path initialises: mpv renders into media_kit's FBO but the frame never lands (Intel Xe2, Mesa 25, mpv 0.40)" | 2026-10-12 | open |
| media-kit `#1464` | "linux: blit mpv's frame into the EGLImage export texture (fixes black video on Mesa, #1463)" | 2026-10-12 | open |
| media-kit `#1366` | "Crash when playing any H264 10bit Video on Windows with NVIDIA GPU" | 2026-01-14 | open |
| media-kit `#1093` | "[Bug Report][Android] vo: 'gpu-next' is unavailable" | 2025-01-28 | open |
| mpv `#18259` | "Bug report: libmpv OpenGL render API — INVALID_ENUM / black hardware-decoded video with subtitles (nvidia-open)" | 2026-07-14 | open |
| mpv `#17626` | "vo=gpu-next has severe performance regression with 8K AV1 10-bit HDR content compared to vo=gpu" | 2026-03-23 | closed, 54 comments |

---

## 4. Frame pacing / vsync / refresh rate

### 4.1 Who controls presentation timing, per mechanism

**`--wid`:** mpv. It owns the swapchain. `--d3d11-sync-interval=<0..4>` "Schedule each frame to be
presented for this number of VBlank intervals. (default: 1) Setting to 1 will enable VSync, setting
to 0 will disable it." `--d3d11-output-mode=<auto|window|composition>`; `--d3d11-flip=yes` is
"flip-model presentation, which avoids unnecessarily copying the backbuffer by sharing surfaces with
the DWM (default: yes)" — and note "flip-model … needs to be disabled for background transparency to
work", i.e. a transparency-based overlay design costs the flip path.

**Render API:** the API user owns presentation, so mpv exposes three knobs:

* `MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME` (`int*`, 0=disable, 1=enable **default**): "When video is
  timed to audio, the player attempts to render video a bit ahead, and then **do a blocking wait until
  the target display time is reached. This blocks `mpv_render_context_render()` for up to the amount
  specified with the `video-timing-offset` global option.** You can set this parameter to 0 to disable
  this kind of waiting. If you do, it's recommended to use the target time value in
  `mpv_render_frame_info` to wait yourself, or to set the `video-timing-offset` to 0 instead.
  **Disabling this without doing anything in addition will result in A/V sync being slightly off.**"
* `MPV_RENDER_PARAM_NEXT_FRAME_INFO` → `mpv_render_frame_info{ uint64_t flags; int64_t target_time; }`.
  `target_time` is "Absolute time at which the frame is supposed to be displayed… `mpv_render_context_render()`
  will normally block until the time is elapsed, unless you pass it
  `MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME = 0`."
* `MPV_RENDER_FRAME_INFO_BLOCK_VSYNC`: "the player timing code **expects that the user thread blocks on
  vsync** (by either delaying the render call, or by making a call to
  `mpv_render_context_report_swap()` at vsync time)."
* `mpv_render_context_report_swap()`: "Tell the renderer that a frame was flipped at the given time.
  This is optional, but **can help the player to achieve better timing**. Note that calling this at
  least once informs libmpv that you will use this function. **If you use it inconsistently, expect
  bad video playback.**"
* `MPV_RENDER_PARAM_SKIP_RENDERING`: "the render API will consider this frame as **having been
  rendered**. All other normal rules also apply, for example about whether you have to call
  `mpv_render_context_report_swap()`. **It also does timing in the same way.**"

**What the two mpv display-sync-relevant option facts are** (manual): `--video-sync` default is
`:audio:` ("Time video frames to audio… This is the default mode."); the `display-*` modes "try to
output video frames completely synchronously to the display, using the detected display vertical
refresh rate as a hint", and "**These modes also require a vsync blocked presentation mode.** For
OpenGL, this translates to `--opengl-swapinterval=1`. For Vulkan, this translates to
`--vulkan-swap-mode=fifo` (or `fifo-relaxed`)."

**mpv's `video-out-params`/vsync state depends on presentation feedback.** `vsync-ratio` and
`display-fps` are how you observe it.

### 4.2 What each stack actually does (verified from code)

| Stack | Timing behaviour found in code |
|---|---|
| `media_kit_video` Windows | Sets `video-sync=audio` explicitly (`video_output.cc:35`). Calls `mpv_render_context_render()` with only `OPENGL_FBO`; **does not** call `mpv_render_context_report_swap()`; **does not** set `BLOCK_FOR_TARGET_TIME` (so mpv's default 1 applies → mpv blocks inside `render()`). |
| `media_kit_video` Linux | Sets `video-sync=audio` explicitly (`video_output.cc:138`). Passes **`{MPV_RENDER_PARAM_BLOCK_FOR_TARGET_TIME, &block_for_target_time}` with `block_for_target_time = 0`** (`texture_gl.cc:243–247`) — mpv therefore does **not** block; the client is supposed to wait on `target_time` itself. It **does not** call `mpv_render_context_report_swap()` anywhere in `texture_gl.cc`. |
| Qt / Stremio shell | `Renderer::render()` runs on Qt Quick's render thread as part of the scene graph pass (class doc: "On most platforms, the rendering will occur on a dedicated thread"). The shell passes only `OPENGL_FBO` and `FLIP_Y` — no `BLOCK_FOR_TARGET_TIME`, no `report_swap`. `main.cpp` forces the ANGLE/D3D9 ES path. Related: `stremio-shell#144` "Stuttering on 144HZ displays when using full screen mode." (2020-06-29, open) and `#494` (2026-07-06, open) on the renderer's CPU cost. |
| egui + glow | `render_glow()` gates the render call on `render_ctx.update()` flags, but sets `video-timing-offset=0.0` and passes no `BLOCK_FOR_TARGET_TIME` and never calls `report_swap`. Repaints are driven by egui (`render_ctx.set_update_callback(move || { egui_ctx.request_repaint(); })`). |

The decisive media_kit finding is issue **#1425**, "[Linux] `mpv_render_context_report_swap()` never
called — vsync-ratio always null, display-sync modes broken", opened **2026-06-11**, **open**,
1 comment. Verbatim from the report:

> "`mpv_render_context_report_swap()` is never called anywhere in `media_kit_video/linux/texture_gl.cc`
> after `mpv_render_context_render()`. … Without this call: `vsync-ratio` property always returns
> null/empty during playback; `display-fps` is unknown to mpv internally; `video-sync=display-vdrop`,
> `display-resample`, `display-adrop` all operate blind — they cannot pace frames correctly because
> mpv has no presentation timing data. Playback is choppy/juddering on hardware where display-sync
> matters… Comparison: **Standalone `mpv` with `vo=gpu` on the same machine, same content — plays
> perfectly with vsync-ratio reporting correctly. The issue is exclusively the Flutter texture render
> path in media_kit.**"

I independently confirmed by reading `media_kit_video/linux/texture_gl.cc` that
`mpv_render_context_report_swap` is absent from the render function and that
`block_for_target_time = 0`.

Other frame-pacing/tearing reports (title/date/state from the API):

| Issue | Title | Opened | State |
|---|---|---|---|
| media-kit `#1425` | "[Linux] `mpv_render_context_report_swap()` never called — vsync-ratio always null, display-sync modes broken" | 2026-06-11 | open |
| media-kit `#1439` | "Linux: <60 fps videos stall the Flutter frame pipeline (danmaku/UI stutter)" | 2026-08-05 | closed |
| media-kit `#1345` | "[Linux] video tearing when building with flutter 3.38.x" | 2025-12-13 | open, 2 comments |
| media-kit `#1346` | "feat(linux): dedicated render thread" | 2025-12-14 | open, 4 comments |
| media-kit `#1404` | "[Linux] H/W rendering fails on Flutter 3.38+ — EGL display not current on platform thread" | 2026-04-08 | open, 3 comments |
| media-kit `#1325` | "fix(linux): fix h/w render" | 2025-11-15 | closed |
| media-kit `#1273` | "[Dash LIVE CHANNEL]: problem on desktop, Video Freeze, video is behind the sound…" | 2025-09-21 | open, 5 comments |
| Stremio shell `#144` | "Stuttering on 144HZ displays when using full screen mode." | 2020-06-29 | open |

`media-kit#1345` bodies (read on the page): reporter on Linux Mint / X11 with an AMD RX 580 sees
tearing with Flutter 3.38.x and none with 3.35.7, and none on Wayland; a second reporter
(2026-03-08) reproduced on Fedora/KDE Wayland with Flutter 3.41.3 and `media_kit 1.2.6` /
`media_kit_video 2.0.1`, "Downgrading flutter to 3.35.7 worked for me"; a third comment (2026-04-21)
says on Android disabling Impeller (falling back to Skia) fixes it.

`[inference]` General shape from the above: with `--wid`, mpv's own swapchain timing
(`d3d11-sync-interval`, flip model, its internal `report_swap`) stays intact; with the render API, the
quality of pacing is a property of the *client's* render loop, and each stack above has at least one
gap (media_kit Linux: `BLOCK_FOR_TARGET_TIME=0` + no `report_swap`; media_kit Windows: no
`report_swap`; Qt: whatever Qt Quick's scene-graph pass does; egui: whatever egui's repaint cadence
does).

### 4.3 WebView2 compositor

For a Tauri/WebView2 host, the webview is an HWND child and the mpv surface is another window
(mechanism A) or a native surface under it — the WebView2 compositor is not in the video path in the
configurations verified in the companion doc (§3.1: Harbor = mpv child HWND at `HWND_BOTTOM`, WebView2
transparent above; Ventic = mpv above, region cut-outs). `[inference]` therefore the WebView2
compositor's timing does not pace video in those configurations; it only affects whether the overlay
repaints. Related reported issues: `tauri-apps/tauri#13270`, "Enabling `transparent: true` improves
resize performance and eliminates artifacts (black/white bars)", **2025-04-21**, open;
`tauri-apps/tauri#9220` (closed as not planned) on GTK/wgpu surface contention;
`tauri-apps/tauri#8246` (closed 2024-03-28) — all per companion doc §3.1 plus the API title/date above.

---

## 5. Audio

**Nothing in any of the mechanisms read here routes audio through the UI toolkit.** Every path keeps
mpv's own audio output:

* `media_kit` sets mpv properties and lets mpv's AO work. Verified from
  `media_kit/lib/src/player/native/player/real.dart`: on Android physical devices / API > 25 it forces
  `'ao': 'opensles'`; on Android emulators with API ≤ 25 it sets `'ao': 'null'` (with the comment
  "Disable audio output on older Android emulators with API Level < 25. OpenSL ES audio output seems
  to be broken on some of these."). It also sets `'audio-display': 'no'` (suppresses cover art).
  It exposes `audio-device` (`await _setPropertyString('audio-device', audioDevice.name)`), and
  `audio-params` / `audio-bitrate` as observable properties.
* `PlayerConfiguration.pitch` (default `false`) "uses `scaletempo` under the hood & disables
  `audio-pitch-correction`" — code path: `_setPropertyFlag('audio-pitch-correction', false)`.
* `PlayerConfiguration.iosManageAudioSession` (**default `true`**): "Whether `Player` should let mpv
  configure and activate the global `AVAudioSession` on iOS. When `false`, the AudioUnit audio output
  skips `setCategory`, `setActive:YES` on init, and `setActive:NO` on dispose — leaving the session
  under the embedder's control." This is the one place where a UI/app layer can affect mpv's audio
  (session ownership on iOS), and it is a documented, opt-out default.
* Stremio shell sets `audio-client-name`, `audio-fallback-to-null=yes`, `title` only
  (`Stremio/stremio-shell@master mpv.cpp`); it does not touch AO or SPDIF.
* egui-sharkplayer and the render-API examples touch no audio options.
* The companion doc's Harbor notes show the same shape (mpv owns audio; the toolkit only gets a
  window).

**Passthrough / bitstream facts that packaging can affect** (all from `DOCS/man/options.rst`):

* `--audio-spdif=<codecs>`: "List of codecs for which compressed audio passthrough should be used.
  This works for both classic S/PDIF and HDMI. Possible codecs are `ac3`, `dts`, `dts-hd`, `eac3`,
  `truehd`, `dsd`." And: "`dsd` enables bit-perfect passthrough of DSD audio, **requires an audio
  output with exclusive device access (currently `wasapi`)** and a DAC that accepts DoP at the
  resulting PCM rate (176.4 kHz for DSD64, 352.8 kHz for DSD128, and so on)." Warning in the manual:
  "There is not much reason to use this. HDMI supports uncompressed multichannel PCM, and mpv
  supports lossless DTS-HD decoding via FFmpeg's new DCA decoder".
* `--audio-exclusive=<yes|no>`: "This only works for some audio outputs, such as `wasapi`,
  `coreaudio`, `pipewire` and `audiounit`. Other audio outputs silently ignore this option."
* `--audio-channels`: the manual warns that `auto` "can cause issues when using audio over HDMI",
  recommends an explicit whitelist ("`--audio-channels=7.1,5.1,stereo`"), and notes
  "Another work-around for this on some AOs is to use `--audio-exclusive=yes` to circumvent the
  system mixer entirely."
* `--volume`: "This always controls the internal mixer (aka software volume)."
* The deprecated `--ad-spdif-dtshd` / `--ad`-based passthrough routes are explicitly dead: "Enabling
  compressed audio passthrough (AC3 and DTS via SPDIF/HDMI) with this option is not possible. Use
  `--audio-spdif` instead."

Two audio-quality reports on the tracker (title/date/state from the API):
`media-kit#952`, "No sound when play TrueHD track in MKV", **2024-09-14**, closed, **20 comments**;
`media-kit#561`, "Sorry, neither hdmv_pgs_subtitle nor trueHD are supported?", **2023-10-29**,
closed. I read neither thread's comments, so I do not report their resolutions (§9).

`[inference]` Since every mechanism above leaves mpv as the audio owner and only differs in *which
window/context mpv draws into*, none of them should change `--audio-spdif` or `--audio-exclusive`
behaviour by itself. The audio risks that are documented as real are (a) platform AO differences, which
media_kit overrides explicitly on Android (`opensles`), and (b) packaging/`ao` availability (e.g. the
`media_kit_libs_*` shared-library bundles), which is out of scope here.

---

## 6. Colour/quality complaints in the wild

All rows read from the GitHub API on 2026-10-15; "comments" are the API's `comments` count.

### media_kit / Flutter

| Issue | Title | Opened | State | Cmts |
|---|---|---|---|---|
| `media-kit/media-kit#615` | "Video Player HDR Problem" | 2023-11-22 | open | 26 |
| `media-kit/media-kit#573` | "[Enhancement][Android] HDR configuration" | 2023-11-06 | closed | 18 |
| `media-kit/media-kit#1207` | "Video playback in HDR10 format is abnormal." | 2025-06-23 | open | 1 |
| `media-kit/media-kit#1354` | "How to correct color display of Dolby Profile5 video?" | 2025-12-22 | open | 4 |
| `media-kit/media-kit#1434` | "color is not right" | 2026-07-16 | open | 0 |
| `media-kit/media-kit#1438` | "Linux GLES: color shift with precision-sensitive libmpv user shaders" | 2026-08-04 | open | 0 |
| `media-kit/media-kit#1293` | "[android]On some devices - RTSP stream is overexposed / incorrect colors" | 2025-10-12 | closed | 1 |
| `media-kit/media-kit#843` | "Crash on playing HDR video iOS emulator" | 2024-05-29 | open | 1 |
| `media-kit/media-kit#1329` | "Video Not playing on specific Android Device" | 2025-11-18 | closed | 3 |
| `flutter/flutter#194156` | "[Flutter GPU] `GpuContext.defaultColorFormat` returns `PixelFormat.unknown` with wide gamut on Metal" | 2026-10-11 | open | 1 |
| `flutter/flutter#194166` | "[Flutter GPU] `defaultColorFormat` stays usable with wide gamut on Metal" (PR) | 2026-10-11 | open | 0 |
| `flutter/flutter#191805` | "[iOS] HDR image renders with artifacts on real device, using Image widget" | 2026-08-26 | closed | 1 |
| `flutter/flutter#193089` | "[image_picker_ios] Picking an iOS 26+ HDR screenshot (10-bit HEIF) returns a 0-byte file…" | 2026-09-21 | open | 4 |
| `flutter/flutter#141207` | "[Platform view] Virtual Display renders too dark on some Android phones" | 2024-01-09 | open | 6 |
| `flutter/flutter#191978` | "[Windows] Regression in 3.47.0: black window on GPUs limited to D3D11 feature level 9_3 — compositor passes sized internal formats on an ES 2.0 context" | 2026-08-28 | closed | 16 |

Note on the last Flutter row: it is a *compositor* bug about sized internal formats on an ES 2.0
context, i.e. the same class of hazard as mpv's `internal_format` handling, on the Flutter side.
`media-kit#573` ("[Enhancement][Android] HDR configuration") is the one where `alexmercerind` said
`gpu-next` "can probably be used on main branch now" (2024-09-28, quoted inside #615) before walking
that back to "only works on Android right now" (2024-10-07).

### mpv (upstream, affects all mechanisms that use `gpu-next`)

| Issue/PR | Title | Opened | State |
|---|---|---|---|
| `mpv-player/mpv#10810` | "Support for libplacebo (gpu-next) in the rendering API" | 2022-10-29 | open |
| `mpv-player/mpv#16818` | PR "vo_libmpv: introduce 'gpu-next' render backend" | 2025-09-20 | **draft**, milestone removed 2026-01-23 |
| `mpv-player/mpv#18607` | PR "[RFC] vo_libmpv: add gpu-next OpenGL render API" | 2026-10-13 | open |
| `mpv-player/mpv#6575` | "Add vulkan output to embedded rendering API (libmpv)" | (cross-linked from #16818) | open |
| `mpv-player/mpv#15107` | "HDR screenshots are unimplemented (gpu/gpu-next)" | 2024-10-16 | open |
| `mpv-player/mpv#16874` | "washed out/overexposed output with macvk + gpu-next" | 2025-10-04 | open, 15 |
| `mpv-player/mpv#15138` | "Playback dim when display color space set to Rec. ITU-R BT.2020-1" | 2024-10-20 | open, 40 |
| `mpv-player/mpv#18220` | "SDR peak brightness incorrect when enable ICC profile" | 2026-07-04 | closed |
| `mpv-player/mpv#17850` | "scRGB output clamped to sRGB color gamut when SDR ACM is enabled" | 2026-04-30 | closed |
| `mpv-player/mpv#18417` | "Corrupted mastering display primaries (degenerate gamut) cause severe color/luma distortion" | 2026-08-28 | open |
| `mpv-player/mpv#18445` | "Most (maybe all) HDR playback fails using gpu or gpu-next, **works robustly using libmpv**" | 2026-09-04 | open, 7 |

`#18445` deserves a precision note, because the title looks like the opposite of the rest of this
document. Read on the page: it is **macOS-only** (labels `os:mac`, `vo:gpu:macvk`), the reporter is on
macOS 15.7.3 with homebrew mpv 0.41.0, and "with **`vo=libmpv`** and no other config, HDR plays
normally". On macOS, `vo=libmpv` is **not** the FBO render API — `vo.rst` says: "As a special case, on
macOS it is used like a normal VO within mpv (cocoa-cb)." So this report is about the cocoa-cb VO
activating EDR vs. `gpu`/`gpu-next` with the `macvk` context failing to; it is not evidence about the
FBO render API, and it is not a Windows/Linux statement.

`mpv#18286`, "gpu_next: In HDR/Dolby Vision, PGS graphic subtitles inherit the video color space and
produce obvious color shift", opened **2026-07-24**, open, 7 comments. It is about `vo=gpu-next` in
general (any mechanism that uses `gpu-next`), the fix was rejected by a contributor
(`cubicibo`, 2026-08-03: "mpv handles correctly DVB and PGS: those are always authored in the video
colour space. Your proposal breaks all correctly generated graphic subtitles."), and the reporter
later agreed and said they still had not upstreamed it. It is relevant to §7 only in that HDR + graphic
subtitles is a known-bad combination on `gpu-next`.

### Stremio / Qt / Tauri

Covered in §2.5 (shell #494, #441, #144, #425; shell-ng #73, #43) and §4.3
(`tauri-apps/tauri#13270`, #9220, #8246). Also `Stremio/stremio-shell#453` "Feature Request: Option to
Change App Background Color / Theme" (2025-10-11, open) — UI colour, not video.

### Cove

The only search hit in the HDR/colour/stutter space is `coveninja/cove#86`, "Fix desktop video
portability and Flatpak decoder support" (**2026-10-09**, open) and `cove#7`, "[Bug]: Hyprland
Workspace Change Leaves Window Black Temorarily" (2026-07-17, closed). I did not open either. §9.

---

## 7. Subtitles (ASS/SSA, libass, positioning/scale)

### 7.1 What mpv offers and what "rendering it yourself" costs

`DOCS/man/input.rst` properties:

* `sub-text` / `secondary-sub-text`: "The current subtitle text regardless of sub visibility.
  **Formatting is stripped.** If the subtitle is not text-based (i.e. DVD/BD subtitles), an empty
  string is returned."
* `sub-text/ass`: "Like `sub-text`, but return the text in ASS format… **This property is not enough
  to render ASS subtitles correctly, because ASS header and per-event metadata are not returned.**"
* `sub-text/ass-full`: "the full event with all fields, formatted as lines in a .ass text file. Use
  with `sub-ass-extradata` for style information."
* `sub-lines`: "The list of subtitle lines in memory. **Not available if the subtitle is not
  text-based (i.e. DVD/BD subtitles).** … **ASS tags are stripped from `text`.**"

So the *only* way to get correct ASS rendering is to let libass do it inside mpv
(`sub-ass=yes`, `sub-visibility=yes`), because libass draws into mpv's render target. Any client that
draws subtitles itself from `sub-text` necessarily loses ASS styling, positioning, fonts and
karaoke/`\pos`/`\move` semantics.

### 7.2 `media_kit` draws subtitles itself, by default

* `PlayerConfiguration.libass` — doc: "Whether to use libass based subtitle rendering for native
  backend. **By default, subtitles rendering is Flutter `Widget` based.**" Constructor default:
  `this.libass = false` (`media_kit/lib/src/player/platform_player.dart:543`).
* The consequence in mpv properties (`real.dart:2504–2506`):
  `'sub-ass': configuration.libass ? 'yes' : 'no'`, `'sub-visibility': …`,
  `'secondary-sub-visibility': …`. With the default `libass = false`, mpv is told **not to render
  ASS subtitles into the video frame** and **not to show subtitles at all**; the text is instead
  observed as properties `sub-text` / `secondary-sub-text` (`real.dart:2547–2548`) and handed to a
  Dart `SubtitleView`.
* `media_kit_video/lib/src/subtitle/subtitle_view.dart` renders each line as a Flutter `Text` with
  `widget.configuration.style` (default `fontSize: 32.0`, `fontWeight: FontWeight.normal`, white) and
  a scale factor computed as `sqrt(area / (1920.0 * 1080.0))` clamped to `[0,1]` — i.e. the
  positioning/scale is Flutter's, not libass's, and it is anchored to the widget box.
* The tracker matches this: `media-kit#1322` "**[Feature Request] Add support for subtitle styling
  (outline + shadow)**" (2025-11-13, open) and `media-kit#1302` "subtitleViewConfiguration is ignored
  — subtitles always use default white style" (2025-10-23, closed). Both are only meaningful if
  media_kit is drawing the text.
* Graphic subtitles (PGS/VobSub/DVB) have no text form at all (mpv returns an empty string for
  `sub-text`), which is consistent with the reported failures: `media-kit#1426` "[Bug] Android:
  PGS/HDMV (graphic-based) subtitles are detected and selected but fail to render on screen"
  (2026-06-17, closed), `media-kit#1371` "Bug Report: PGSSUB/HDMV subtitles not rendering on all
  platforms" (2026-01-19, closed), and `media-kit#1269` "Android: libmpv.so from
  media_kit_libs_android_video is missing the `hdmv_pgs_subtitle` decoder" (2025-09-17, open).

### 7.3 Per mechanism

| Mechanism | Does mpv's libass render into the video frame? | Notes / evidence |
|---|---|---|
| `--wid` | Yes — mpv owns the whole pipeline; libass draws into mpv's own target. No client involvement. | `sub-ass`/`sub-visibility` are ordinary mpv options. |
| Render API, correctly implemented | Yes — subtitles are part of the frame mpv produces into the FBO; OSD and subtitles are `gpu_next`/`gpu` render passes. | `mpv-examples/libmpv/README.md` (per companion doc §1.5): "you can actually render your own OSD on top of the video, something that is not possible with raw window embedding." |
| Qt / `QQuickFramebufferObject` (Stremio) | Yes, unchanged — the shell only overrides `vo` and `gpu-hwdec-interop`; nothing disables `sub-ass`/`sub-visibility` in `mpv.cpp`. | `Stremio/stremio-shell@master mpv.cpp` (no `sub-*` options found). |
| egui + libmpv2 | Unchanged; no `sub-*` options in `backend.rs`/`widget.rs`. Caveat: mpv's `--sub-scale`/`--sub-pos` are relative to mpv's own render target, which here is the egui FBO of a size egui chose. | egui-sharkplayer source |
| Flutter / `media_kit_video` | **No, by default** (`libass=false` → `sub-ass=no`, `sub-visibility=no`); Flutter draws the text from `sub-text`. Setting `libass = true` restores mpv's libass rendering into the texture (and on Android requires `libassAndroidFont`/`libassAndroidFontName`, because "the system fonts cannot be picked up by libass/fontconfig. This makes libass subtitle rendering fail" — `real.dart:2403`). | §7.2 |
| Cove (Compose/Skia) | Not determined. | §9 |

One HDR-and-subtitles interaction that is **not** mechanism-specific: `mpv#18286` (PGS colour shift on
`gpu-next` in HDR) applies to every stack that lands on `gpu-next` — i.e. `--wid` on Windows and
`media_kit` with `vo: 'gpu-next'`.

---

## 8. What each mechanism does to each quality axis (condensed)

| | `--wid` (mpv owns swapchain) | Render API + a compositor |
|---|---|---|
| 10-bit / HDR passthrough | mpv chooses the format; `--target-colorspace-hint` available on Wayland/D3D11/winvk; `--d3d11-output-format` can be `rgb10_a2`/`rgba16f` | Bounded by the client's target format. Verified ceilings: Flutter `kFlutterDesktopPixelFormat{RGBA8888,BGRA8888}` (8-bit) and `GL_RGBA8_OES`; media_kit Windows `B8G8R8A8_UNORM`; media_kit Linux `GL_RGBA`/`GL_UNSIGNED_BYTE`; Qt `GL_RGBA8`/`GL_RGBA`; egui `RGBA8`. libplacebo is not in the render backend in any released mpv (#10810 open; PR #16818 draft). |
| Tone mapping | mpv's choice, in mpv | Still mpv's choice *inside* the render backend — evidenced by egui-sharkplayer's `// Support HDR video` + `tone-mapping=auto`. |
| Zero-copy hwdec | default path for `d3d11va`/`vaapi`/`videotoolbox` on the matching VO | Requires `ADVANCED_CONTROL` + `vd-lavc-dr=yes` + backend support (render.h); Windows OpenGL needs ANGLE (render_gl.h); D3D11 needs a non-single-threaded device (render_d3d11.h). Compositors add their own copies (media_kit Windows `CopyResource`; SW path caps at 1080p). |
| Frame pacing | mpv's swapchain, `d3d11-sync-interval`, flip model | Client must call `report_swap` and/or honour `target_time` (render.h). Observed gaps: media_kit Linux (`BLOCK_FOR_TARGET_TIME=0`, no `report_swap`, issue #1425), media_kit Windows (no `report_swap`), egui (`video-timing-offset=0`, no `report_swap`). |
| Audio | mpv's AO | mpv's AO (no mechanism routes audio through the toolkit); iOS `AVAudioSession` ownership is an explicit media_kit option. |
| Subtitles | libass in mpv | libass in mpv *unless* the client opts to draw them (media_kit default: draws them itself, `libass=false`). |
| Picture-quality defaults in the layer | whatever the user configured | media_kit additionally hardcodes `dither=no`, `scale=bilinear`, `dscale=bilinear`, `correct-downscaling=no`, `linear-downscaling=no`, `sigmoid-upscaling=no`, `hdr-compute-peak=no`. |

---

## 9. Could not verify

1. **Cove's desktop video mechanism and pixel format.** `coveninja/cove` exists (AGPL-3.0, Kotlin
   Multiplatform, Compose Multiplatform; `README.md`, `ARCHITECTURE.md`) and its `ARCHITECTURE.md`
   says "Desktop mpv stays in-process through JNA. The OpenGL path retains GPU rendering and hardware
   decoding; software rendering remains the controlled fallback" and lists "`app/desktop` … mpv
   surfaces". I did **not** read its Kotlin/Java sources, so I cannot say whether desktop uses
   `--wid`, the render API, or something else; what the Skia/Compose surface's pixel format is; or
   whether HDR survives. I also did not open `cove#86` (2026-10-09) or `cove#7` (2026-07-17).
2. **No published mpv release ships the D3D11 render API.** The companion doc (§1.2) read
   `DOCS/client-api-changes.rst` (D3D11 API under `--- mpv 0.42.0 ---`; last tag v0.41.0) and the one
   commit on `include/mpv/render_d3d11.h` (2026-04-17). I did not inspect a shipped binary or a
   prebuilt dev bundle to confirm whether any distribution exposes it.
3. **The exact moment `FlutterDesktopGpuSurfaceDescriptor` gained/lost anything.** I verified the
   *current* `main` content of `shell/platform/common/public/flutter_texture_registrar.h` (two 8-bit
   formats). I could not read `flutter/engine` branch heads (`stable`, `beta` returned 404 on the raw
   path) nor the Windows `public/` directory beyond `flutter_windows.h`, so I cannot say when a
   10-bit/HDR format was last proposed. `flutter/flutter#194156`/`#194166` (2026-10-11) are the only
   wide-gamut items I found, and they are Flutter GPU (Metal), not platform textures.
4. **Android `ImageReaderSurfaceProducer`'s baked pixel format.** I tried
   `shell/platform/android/io/flutter/embedding/engine/renderer/ImageReaderSurfaceProducer.java` and
   `.../view/ImageReaderSurfaceProducer.java` — both 404 on engine `main`. Not verified; I therefore
   make no claim about the Android texture path's bit depth.
5. **`media-kit#952` (TrueHD) and `#561` (PGS/TrueHD) resolutions.** I read only titles, dates, states
   and comment counts, not the threads.
6. **Whether any of `media-kit`'s hardcoded quality defaults (`dither=no`, `scale=bilinear`, …) have
   an override path.** I read them from `main`'s property map and read the full `PlayerConfiguration`
   field list; I did not search for a later runtime override elsewhere in the Dart code.
7. **`media_kit`'s macOS/iOS render path details.** I read the Windows and Linux C++ and the shared
   Dart; I did not read `TextureHW.swift` beyond a grep (which matched only `internal_format: 0`).
8. **`Stremio/stremio-shell` runtime hwdec.** The shell's own comment says
   "Enable opengl-hwdec-interop so we can set hwdec at runtime", i.e. `hwdec` is set by the web UI,
   not by C++. I could not read that UI/JS layer.
9. **Qt Quick's presentation cadence for `QQuickFramebufferObject`.** I verified the class doc's
   "the rendering will occur on a dedicated thread" and read the node/render wiring in
   `qquickframebufferobject.cpp`, but I did not determine how Qt Quick's animation/`QSG` loop relates
   to display vsync in a way that would let me state mpv's pacing is or is not correct there.
10. **Issue-comment content in general.** Every row in §6 that lists "comments = N" without a quote is
    title/date/state/labels only. Only the issues I name as read (`media-kit#615`, `#1345`, `#1425`,
    `mpv#18286`, `mpv#18445`, `mpv#16818`) had their bodies read.
11. **`[inference]` labels** mark conclusions I drew rather than read: §2.3 (render API + HDR on a
    released mpv), §2.5 (Stremio's output bit depth), §3.1 (compositor copies), §4.3 (WebView2 not in
    the video timing path), §5 (audio unaffected by mechanism), §6 (Cove gaps).
