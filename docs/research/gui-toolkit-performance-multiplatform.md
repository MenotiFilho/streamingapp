# UI toolkit performance & multiplatform reality for a media-browsing app — fact-finding

**Date of research:** 2026-10-15 (every GitHub API / crates.io / docs read was done on this date).
**Scope:** verifiable facts only. No recommendations. Inferences are labelled `[inference]`; anything I could not confirm is in §13.
**Question being evaluated:** an app with poster walls, horizontal rails, hero art, full-screen focus navigation and an in-player overlay; menus must feel instant, a millions-of-pixels image wall must scroll smoothly, input must come from arrow keys / gamepad / TV remote as well as the mouse, and it must ship on Windows + Linux (macOS nice-to-have, Android TV a possible later target) from one codebase.

**Environment/date note:** as in `docs/research/libmpv-embedding-facts.md`, this environment's sources carry dates that sit in the future relative to a naive reading. I report each version and date exactly as the source states it, and I verified each GitHub/staging fact two ways (GitHub API + the project's own release notes or docs) where possible.

Companion document: `docs/research/libmpv-embedding-facts.md` (same repo) already covers the *libmpv* side in depth (render API backends, `wid` embedding, harbor/ventic/Stremio, licenses). This document covers the *toolkit* side and cross-references it where the two overlap; it does not repeat the mpv API detail.

---

## 0. Version and license snapshot (all verified on 2026-10-15)

| Toolkit | Current version | Date | License | Source |
|---|---|---|---|---|
| Flutter desktop (Impeller/Skia) | **3.47** (latest patch tag `3.47.7`; `3.48/3.49` are pre-releases) | blog post 2026-08-12 | BSD-3-Clause | flutter.dev/blog/whats-new-in-flutter-3-47; `gh api repos/flutter/flutter/git/matching-refs/tags/3.4` |
| Tauri 2 (WebView2/WebKitGTK/Android WebView) | **2.12.4** (stable, 2026-10-14); 3.0.0-alpha.5 also published 2026-10-14 | 2.0.0 stable was **2024-10-02** | Apache-2.0 OR MIT | `gh api repos/tauri-apps/tauri/releases`; v2.tauri.app/blog/tauri-20 |
| wry (Tauri's webview layer) | **0.57.0** (2026-09-08) | — | Apache-2.0 OR MIT | `gh api repos/tauri-apps/wry/releases/latest` |
| egui / eframe | **0.37.0** (2026-10-15) | — | MIT OR Apache-2.0 | docs.rs/crate/egui/0.37.0 |
| Qt 6 / Qt Quick (QML scene graph) | **6.12 LTS** (2026-09-30); Qt 6.11.2 is the previous line in the docs | LTS, 5 years of maintenance | dual: commercial, or LGPL-3.0 (some parts GPL-only) | qt.io/blog/qt-6.12-released; qt.io/licensing/open-source-lgpl-obligations |
| Compose Multiplatform (Skia/Skiko) | **1.12.2** (2026-10-15); 1.12.0 was 2026-08-25 | 1.13.0-alpha02 is 2026-10-06 | Apache-2.0 | `gh api repos/JetBrains/compose-multiplatform/releases` |
| Slint | **v1.18.1** (2026-09-21) | — | GPL-3.0-only OR Slint Royalty-free 2.0 OR commercial | `gh api`; slint-ui/slint `LICENSE.md` |
| Avalonia | **12.1.4** (2026-10-09) | — | MIT | `gh api repos/AvaloniaUI/Avalonia/releases/latest` |
| Iced | **0.14.0** (released 2025-12-07) | README: "currently experimental software" | MIT | `gh api repos/iced-rs/iced/releases/latest`; iced-rs/iced README |
| Zed / GPUI | Zed **v1.24.2** (2026-10-14); `gpui` crate **0.2.2** published 2025-10-22 | — | `gpui` crate Apache-2.0; Zed repo has `LICENSE-APACHE` **and** `LICENSE-GPL` | `gh api`; docs.rs/gpui-unofficial |

Reference points used for the "media app at this scale" question: Kodi **21.3-Omega** (2025-10-31, GPL-2.0-or-later), Jellyfin Desktop **v2.0.0** (Dec 2025, GPL-2.0), jellyfin-mpv-shim **v3.1.0** (2026-10-05), Stremio desktop shell **4.4.107** (2020, GPL-3.0), Stremio shell-ng **v5.0.26** (2026-09-22), ventic **v0.7.5** (2026-10-11, MIT), covenant/cove **v1.6.0** (2026-10-09, AGPL-3.0), Fladder **v0.11.1** (2026-09-08, GPL-3.0), mediamp (Apache-2.0), plezy (GPL-3.0), 9000000/harbor (MIT).

---

## 1. Summary matrix

Legend: **●** first-party/documented · **◐** possible with third-party code or flags · **○** not found / not supported.

| | GPU composite by default | Virtualised long lists | Image decode/cache story | Built-in focus traversal | Gamepad / TV remote | Win | Linux | Android/TV | Notes |
|---|---|---|---|---|---|---|---|---|---|
| **Flutter desktop** | ● Impeller default on macOS/Win/Linux since 3.47 (Metal; **Vulkan on Windows/Linux**) | ● `ListView.builder`, slivers (`cacheExtent` default 250 lp) | ● `ImageCache` LRU 1000 imgs / 100 MB; `cacheWidth/Height`, `ResizeImage` | ● full focus tree (`Focus`/`FocusNode`/`FocusTraversalGroup`) | ◐ physical keys built in; D-pad/focus-region behaviour needs `dpad` package or equivalent | ● | ● | ● (Fladder ships Android+TV) | Impeller precompiles shaders (no runtime shader-compile jank) |
| **Tauri 2** | ● webview compositing (WebView2 Chromium; WebKitGTK on Linux) | ● JS virtualisers (TanStack Virtual `mount-fixed-100k` ≈ 4.5 ms; react-window etc.) | ● browser image pipeline + service worker/HTTP cache | ◐ DOM `tabindex`/`:focus-visible`, but TV semantics are DIY | ◐ no framework support; DIY from key events | ● | ◐ works but WebKitGTK GPU path is the weak spot (§3.4) | ● v2 supports Android (system WebView, Chromium-based) | smallest binaries; runtime perf = the OS webview |
| **egui / eframe** | ● wgpu (or glow) | ◐ `ScrollArea::show_rows` / `show_viewport` for fixed-height rows only | ○ no built-in disk/network cache; `egui_extras` loaders; textures larger than `max_texture_side` need `egui_large_image` | ◐ tab focus + (arrow-key) directional focus, no window awareness | ◐ arrow-keys via PR #3272; full gamepad is third-party (`bevy-egui-kbgp`) | ● | ● | ◐ eframe Android (merged PR #5318) or `sagebind/egui-android`; desktop-only users: JVM-free, tiny | README: ~1–2 ms/frame expected; **huge scroll areas are the known pathology** |
| **Qt6 / QML** | ● scene graph over RHI (GL/Vulkan/Metal/D3D11/D3D12), threaded render loop | ● `ListView` (instantiate-on-visible) + `cacheBuffer`, `reuseItems` (item pooling since 5.15) | ● `Image.asynchronous`, `sourceSize`, native `QQuickImageProvider` | ● `activeFocusOnTab`, `KeyNavigation`, ListView is a focus scope | ◐ **QtGamepad was not ported to Qt 6**; community ports (`qtgamepadlegacy`, QtSDL) or raw key events | ● | ● | ● Qt for Android (Qt Quick) | the only toolkit here with a shipped "web UI + libmpv in the same window" HTPC app |
| **Compose Multiplatform desktop** | ● Skiko/Skia (D3D12 on Windows, OpenGL elsewhere; software fallback up to 4× slower) | ● `LazyRow`/`LazyColumn` (Android + desktop) | ● Coil 3 multiplatform (`AsyncImage`); known LazyRow cancel bug (#3379); TV/grid perf issue #2584 fixed in 3.1.0 | ● `FocusRequester`, `focusGroup`, `onKeyEvent`; Android TV has `androidx.tv.material3` (stable 1.0.0, 2024-08-21) + `TvLazyRow` | ● on Android TV via tv-material; **CMP 1.11.0 added tvOS Siri Remote events**; desktop D-pad is DIY | ● | ● | ● (via the Android target; cove ships Android) | desktop AOT/AppCDS only in 1.13.0-alpha01; JVM startup is the tax |
| **Slint** | ● femtovg (GL / wgpu), Skia, Vello (experimental), or software | ● `ListView` "only instantiates visible elements"; `ScrollView` always instantiates all children | ○ no image-cache network story found; model laziness is DIY (issue #4561) | ● `FocusScope` + `KeyBinding` + key event delivery chain | ○ not found | ● | ● | ● official Android backend (`android-activity`, IME in Java) | tiny footprint claim: runtime < 300 KiB RAM (vendor claim) |
| **Avalonia** | ◐ Skia *with* GPU acceleration per the perf docs; the architecture page says software composition is the default on most platforms — **the two pages disagree** (see §8.1) | ● `VirtualizingStackPanel` + `BufferFactor`; docs warn variable-height items cause scroll jumps | ● `Bitmap`, `RenderOptions.BitmapInterpolationMode`, GPU resource cache default ≈28 MB (configurable) | ● `FocusManager`, `IsTabStop`, keyboard nav | ○ not built in | ● | ● (X11; native Wayland opt-in since 12.1.0) | ● Android/iOS/WASM + embedded DRM/framebuffer | issue #21213: "Avalonia compositor is too slow for real time rendering" (12.0, Windows, 50 fps vs 100 fps native) |
| **Iced** | ● `iced_wgpu` (Vulkan/Metal/DX12) or `iced_tiny_skia` (CPU) | ◐ `lazy` widget (feature `lazy`) re-renders on hash change; no image-wall virtualiser | ◐ `image` feature, but list virtualisation is manual | ◐ focus primitives (`operation::focusable`, `focus_next/previous`) exist but only `TextInput`/`TextEditor` implement `Focusable` (third-party `iced_focus`) | ○ not found | ● | ● | ○ no mobile target in the documented platforms | main precedent is the COSMIC desktop; no media app found |
| **GPUI** | ● Metal (macOS), Vulkan (Linux, moved to wgpu on main), Direct3D 11 (Windows) | ? no public documentation found (see §13) | ○ not found | ● documented key dispatch (`gpui.rs` `key_dispatch` doc) | ○ not found | ● (Zed GA Windows 2025-10-15) | ● | ○ | Zed-team investment in the framework has been explicitly slowed (§10) |

---

## 2. Flutter desktop (Impeller/Skia)

### 2.1 Rendering model and frame budget
- Budget is documented: "Flutter is designed to render its UI at 60 frames per second (fps), or 120 fps on devices capable of 120Hz updates… approximately every 16ms the UI updates", and a frame over ~16 ms is flagged as jank (`docs.flutter.dev/tools/devtools/performance`).
- **Impeller is the default renderer on macOS, Windows and Linux as of Flutter 3.47** (blog 2026-08-12; docs page `docs.flutter.dev/perf/impeller`, page updated 2026-08-21). Platform APIs: Metal on macOS, **Vulkan on Windows and Linux** (blog). Opt-outs exist (`FLTEnableImpeller`, `project.set_impeller_switch(Disabled)`, `fl_dart_project_set_enable_impeller`) and "fallback options will be removed in a future release".
- Impeller's stated objectives include "Predictable performance" (all shaders and pipeline state compiled/cached offline at build time), explicit caching, and distributing single-frame workloads across multiple threads (docs). The 3.47 blog states the practical effect: "eliminates the brief stutter, called shader compilation jank, the first time an animation plays".
- 3.47 also enabled **SDF text rendering on macOS/Linux/Windows** to sharpen desktop text.
- 120 Hz: the docs' claim is "120 fps on devices capable of 120Hz updates"; I found **no official Flutter benchmark table** for desktop fps on a specific GPU (see §13).

### 2.2 Long lists / decoding / caching
- `ListView.builder` "is appropriate for list views with a large (or infinite) number of children because the builder is called only for those children that are actually visible" (`api.flutter.dev/flutter/widgets/ListView-class.html`). Viewports keep a cache extent (documented default 250 logical px beyond each edge).
- `ImageCache` is "a least-recently-used cache of up to 1000 images, and up to 100 MB", tunable via `maximumSize` / `maximumSizeBytes` (`api.flutter.dev/flutter/painting/ImageCache-class.html`).
- Known pathology (documented behaviour, not a bug): a single image larger than `maxByteSize` is not cached at all rather than growing the cache, so the biggest images are re-decoded most often; decoded cost is ≈ w×h×4 bytes regardless of display size — hence the documented habit of decoding at display size with `cacheWidth`/`cacheHeight`/`ResizeImage`.

### 2.3 Focus / keyboard / gamepad
- Flutter has a first-class focus system: `Focus`/`FocusNode`/`FocusScopeNode`, `FocusTraversalGroup`, `FocusTraversalPolicy`, `Shortcuts`/`Actions`, key-event propagation from primary focus to the root, then out to the platform (`docs.flutter.dev/ui/interactivity/focus`).
- **D-pad is where the built-in system falls short for TV.** The `dpad` package (fluttercandies, MIT, v3.0.0, requires Flutter ≥ 3.24) states its reason for existing: "Flutter's built-in directional focus picks the geometrically closest widget. On a real TV layout that means focus jumps lanes between the sidebar and the content, skips rows, escapes carousels, and forgets where you were. Dpad replaces that engine with the model TV platforms actually use (Android's FocusFinder / Leanback)", and it advertises focus regions with memory, press feedback, and a debug focus inspector.
- Android TV media playback in Flutter has a structural wrinkle: `flutter_tv_media3` (MIT) deliberately **runs Media3 in a separate Android Activity with its own FlutterEngine** to get Auto Frame Rate switching and HDR/Dolby Vision, "not as a widget in the Flutter hierarchy".

### 2.4 Platform reality
- Windows, Linux, macOS are all first-party targets; Android and Android TV are the same Android target (Fladder ships Android+Tv builds). No first-class Android TV *shell* support, but the platform is a normal Android app.
- Video in the same window is solved and documented — see §11.

### 2.5 Startup / memory / size
- A neutral cross-framework benchmark (Elanis `web-to-desktop-framework-comparison`, updated 10/2026, run on GitHub CI) reports a Flutter empty app: build size **≈25 MB (Windows x64)**, release memory **≈103 MB (Windows)**, release start **≈1,611 ms (Windows)**; the Linux build-size/start cells are blank and the Flutter numbers are marked WIP for several platforms, so treat this as one data point rather than a spec.
- Real app: **Fladder v0.11.1** (Flutter, GPL-3.0) release assets: Linux AppImage **36.4 MB**, Linux zip **43.0 MB**, Windows setup **64.5 MB**, Windows zip **88.8 MB**, macOS dmg **77.8 MB**, Android arm64 APK **82.2 MB**, `.aab` **132.5 MB**, web zip **21.8 MB**.

### 2.6 Precedent
- **Fladder** (`DonutWare/Fladder`, GPL-3.0, 2,656★, last push 2026-09-18, v0.11.1 2026-09-08) — cross-platform Jellyfin frontend on Flutter; platforms listed: Android + TV, Web/Docker, macOS, Windows, iOS, Linux; Flathub package `nl.jknaapen.fladder`. Discussion #265 ("How can I help you to add Android TV support?") contains a report of 4K/HDR stutter on low-end TV hardware and floats "re-create the client as a native application using Kotlin and Compose" as one option; the maintainer notes Flutter keeps UI development quick but "does however come with performance impacts" for that target.
- **plezy** (`edde746/plezy`, GPL-3.0, 3,751★, last push 2026-10-15) — "Modern cross-platform Plex & Jellyfin client built with Flutter".
- Note: the *official* Jellyfin clients are **not** Flutter — the official desktop client is Qt/QtWebEngine+libmpv (§5.6) and the official Android TV client is native Android.

---

## 3. Tauri 2 (WebView2 + React/TS; WebKitGTK on Linux)

### 3.1 Rendering model and frame budget
- Tauri renders through the OS webview: **WebView2 (Chromium/Edge) on Windows, WebKitGTK on Linux, WKWebView on macOS, the system Android WebView (Chromium-based) on Android** (`v2.tauri.app/reference/webview-versions`). Tauri's process model is one process, not one-process-per-webview.
- Tauri publishes no fps budget of its own; the practical budget is the browser's compositor. The Tauri docs do document **silent performance failures on Linux**: "WebGL and canvas content can silently land on a slow path while the rest of the app looks fine… WebGL2 context creation succeeds even when the result is backed by a software rasterizer or a slow presentation path. There is no error to catch", and WebKitGTK masks the renderer string (`WEBGL_debug_renderer_info` reports `Apple GPU` on every Linux machine). Their recommendation is a non-WebGL fallback plus a user-visible switch (`v2.tauri.app/develop/debug/linux-graphics`).
- There is a long-standing report of poor DOM-element performance on Linux: tauri-apps/tauri **#3988** "[bug] Bad performance on linux… when handling lots of DOM elements", with the reporter noting the same app is fine in Firefox and in Electron on the same machine. **Issue state on 2026-10-15: still open** (opened 2022-era report; last triage label set is empty in the API response).
- Video in the webview (e.g. `<video>`) is not hardware-accelerated by default on Linux; tauri-apps/tauri **#14424** "[feat] set hardware-acceleration-policy for webview on Linux" (opened 2025-11-05 by Charlie-XIAO, **open**) says WebKitGTK exposes a `hardware-acceleration-policy` setting "available in webkitgtk-rs but it does not seem to be available in Tauri". The issue is referenced by a commit "fix: attempt to force WebKitGTK hardware-accelerated video compositing".

### 3.2 Long lists / decoding / caching
- Web virtualisation is mature: TanStack Virtual v3 (MIT) is headless and framework-agnostic; its own reproducible benchmark (`benchmarks/README.md`, run 2026-06-21) reports mount time for a 100k-row fixed list at **6.1 ms** (TanStack) vs 3.1 ms (virtua), 5.0 ms (react-virtuoso), 4.4 ms (react-window), and states "at the list sizes / workloads tested, all four libraries sustain 60 fps with zero dropped frames". The 2026-05-19 perf release cut worst-case `resizeItem` storms from 1.9 s to 1.3 ms and cold mount at 500k items from 14 ms to 2.7 ms.
- Known pathology on the shared webview: an image wall is bounded by the DOM/webview, not by a toolkit's scene graph. The WebKitGTK font-weight bug and the "fonts render too bold on Linux" reports (Medium, Mar 2026) are cosmetic examples of the same "WebKitGTK ≠ Chromium" class of surprise; the performance version of it is #3988 above.

### 3.3 Focus / keyboard / gamepad
- Focus is the DOM's (`tabindex`, `:focus-visible`, arrow-key handlers). There is **no framework-level directional/gamepad navigation**: Tauri exposes no TV/D-pad API; you would build it with key handlers and, on Android TV, the platform's key events. The Tauri docs' Linux note that "WebKitGTK masks the WebGL renderer string" has no keyboard analogue, but the general "the webview is not yours" caveat applies to input dispatch too.
- Gamepad: browser Gamepad API inside the webview (Chromium on Windows/Android; WebKitGTK support for the Gamepad API is the platform's own).

### 3.4 Platform reality (and WebKitGTK's known Linux problems)
- Tauri 2.0 stable (2024-10-02) is the release that added **iOS and Android from the same Rust core** (v2.tauri.app/blog/tauri-20). Maturity is debated in the project's own tracker: discussion #10197 (iOS feedback) says "We were a bit too optimistic about the maturity of Tauri 2… It's more like an alpha".
- **Linux is the weak platform, and it is documented as such**: `v2.tauri.app/develop/debug/linux-graphics` lists blank/white window, flicker on resize, silent death on resize, `AcceleratedSurfaceDMABuf was unable to construct a complete framebuffer`, `Gdk-Message: Error 71 (Protocol error) dispatching to Wayland display`, attributes most to "the WebKitGTK DMABUF renderer requesting buffer formats the NVIDIA driver does not provide", and prescribes escalating workarounds: `nvidia_drm.modeset=1` → `__NV_DISABLE_EXPLICIT_SYNC=1` → `WEBKIT_DISABLE_DMABUF_RENDERER=1` → `WEBKIT_DISABLE_COMPOSITING_MODE=1` (the last "disables accelerated compositing entirely"). The page is tied to tauri-apps/tauri **#9394** (open, labelled documentation + platform: Linux).
- A third-party crate exists specifically to bundle those workarounds per session type: `webkit2gtk-nvidia-quirk`, whose README documents X11 blank windows, Hyprland protocol-error kills, and non-Hyprland "may not start unless NVIDIA explicit sync is disabled", referencing tauri #10702, #9304 and WebKitGTK bug #280210.
- Two concrete, verifiable Linux incidents in the tracker: #13157 "[bug] Glitchy rendering on Linux" (WebKitGTK 2.48, tauri 2.4.1, Ubuntu on Wayland), and the Tauri docs' own list above.

### 3.5 Startup / memory / size (all "documented" numbers)
- Tauri's claim: "a minimal Tauri app can be less than 600KB in size" (`v2.tauri.app/start/`).
- Elanis benchmark (10/2026): Tauri empty app **≈3 MB (Windows x64)**, **≈4 MB (Linux x64)**, **≈5 MB (macOS arm64)**; release memory **≈307 MB (Windows)**, **≈94 MB (Linux)**, **≈96 MB (macOS)**; release start **≈576 ms (Windows)**, **≈1,412 ms (macOS)**, **≈30,331 ms (Linux)**. The Linux start figure is implausible and was already challenged publicly (Hacker News: "There's absolutely no way Tauri apps take 25s to launch"); `[inference]` the Linux column in that table is broken, and I report it only to flag it.
- A vendor blog benchmark (gethopp.app, 2025-04-09, N=1, macOS) reports 6 windows: Tauri ≈172 MB vs Electron ≈409 MB, and bundle 8.6 MiB vs 244 MiB. A counter-analysis in tauri #5889 (2022) argues shared-memory accounting makes Tauri's advantage smaller (PSS on Ubuntu: Electron 207 MB vs Tauri 185 MB).
- Real app: **ventic v0.7.5** (Tauri + Nuxt, MIT): Linux AppImage **93.0 MB**, `.deb` **15.9 MB**, `.rpm` **15.9 MB**, Windows setup **76.2 MB**, `.msi` **103.5 MB**, macOS arm64 dmg **41.3 MB**, Android APK **109.5 MB**.

### 3.6 Precedent
- **ventic/ventic** (MIT, 177★, v0.7.5 2026-10-11, pushed 2026-10-15): "A media library and BitTorrent player for desktop and Android – phone, tablet and TV. Streams torrents into a real embedded mpv window. Built with Nuxt and Tauri. Ships with no sources." It is the closest shipped analog to the Tauri+media hypothesis, and it uses a **separate real mpv window** with region cut-outs (per the companion doc §2.2), i.e. it does not put its UI over the video.
- **9000000/harbor** (MIT, 3★, created and last pushed 2026-06-04): Tauri 2 + React + libmpv Stremio client; parked per this repo's ADR-0001.
- **Stremio/stremio-shell-ng** (Rust, "WebView2/mpv", v5.0.26 2026-09-22, pushed 2026-10-13, **no SPDX license detected by the GitHub API**, and no release assets published) — Stremio's own attempt at exactly this shape of app.
- **Tauri supports Android TV as an Android app**; the third-party `get-air/tauri-video-plugin` (Apache-2.0, 1★, created 2026-08-04) advertises "Native video playback for Tauri 2 with headless, React, Android, and Android TV APIs" and documents that on Linux it installs a `GtkOverlay` around Tauri's original window child so the video follows the HTML anchor while DOM controls stay above it.

---

## 4. egui / eframe

### 4.1 Rendering model and frame budget
- Immediate mode: the whole UI is laid out and painted every frame you run. `eframe` "defaults to using wgpu for rendering (with an option to change to glow)", native via `egui-winit`.
- **egui does not render at a fixed rate**: it repaints only when there is interaction or an animation is requested, so an idle app consumes essentially no CPU (README; `Context::request_repaint` docs).
- The README gives concrete numbers and the known cost centre: "For most cases you can expect `egui` to take up **1-2 ms per frame**"; "Since an immediate mode GUI does a full layout each frame, the layout code needs to be quick. If you have a very complex GUI this can tax the CPU. **In particular, having a very large UI in a scroll area (with very long scrollback) can be slow, as the content needs to be laid out each frame.**" The stated goal is "Responsive: target 60 Hz in debug build".
- Practical consequence `[inference]`: a poster wall whose *whole* content is inside one scroll area is the egui worst case; the mitigation is `show_rows`/`show_viewport`, which is what the docs point to.

### 4.2 Long lists / decoding / caching
- `ScrollArea::show_rows(ui, row_height, total_rows, …)` "Efficiently show only the visible part of a large number of rows" (fixed row height, `10_000` rows in the doc example) and `show_viewport` "can be used to only paint the visible part of the contents" (docs.rs/egui/0.37.0 `ScrollArea`). There is no general variable-height virtualiser.
- Images: `egui_extras::install_image_loaders` + `egui::Image`; the texture-upload constraint is documented in the ecosystem rather than in egui itself — `egui_large_image` exists because "egui uploads every texture in one piece, and a backend accepts only textures up to `max_texture_side`". A third-party audit of egui's API surface (buiy `docs/prior-art/egui/api-surface.md`) summarises: "**No virtualization at scale.** `ScrollArea::show_rows` virtualizes rows but the rest of the UI rebuilds every frame regardless."
- Community reports of the pathology: "having a very large UI in a scroll area can be slow, as the content needs to be laid out each frame" (egui README) and repeated forum reports (users.rust-lang.org "Egui program running very slow").

### 4.3 Focus / keyboard / gamepad
- egui has tab focus and (since PR #3272, 2023-08-23, "Change focused widget with arrow keys") arrow-key directional focus. The PR's own description: it "examine[s] the currently focused widget to determine the [candidate] with the highest dot product… identify the widget that is nearest to the current one", and its stated limitations: "This solution has no sense of the window it exists in, so if a focusable widget in another window is a better candidate it will pick that one", and "If I click in an input box the `Focus::interested_in_focus` is not called and thus I do not know what the interactable widgets and their rectangles are".
- Gamepad is **not** built in: issue #1250 ("Gamepad and arrow-keys navigation support") is the tracking issue, explained there by emilk as requiring rect-aware focus candidates. The practical path is the third-party `bevy-egui-kbgp` (its docs define keyboard *and* gamepad navigation, DPad/left-stick navigation, `prevent_loss_of_focus`, `focus_on_mouse_movement`, and even a "accept a single key/button input from this widget" control-rebinding widget). `bevy-egui-kbgp` is a Bevy-integration crate `[inference]`, so a non-Bevy egui app would need its own glue or the same pattern.
- One more documented friction point: issue #7899 "Allow consuming keyboard events BEFORE egui" — "Right now, egui will consume arrow keys and Tab keys for moving the focus, before the user application have a chance to use them."
- Text input / on-screen keyboard on mobile is explicitly weak: eframe's README says "Bringing up an on-screen keyboard on mobile: there is no JS function to do this, so `eframe` fakes it by adding some invisible DOM elements. It doesn't always work. Mobile text editing is not as good as for a normal web app."

### 4.4 Platform reality
- Desktop (Windows/Linux/macOS) is the well-trodden path. Android: `eframe` "can be compiled both to run natively (for Linux, Mac, Windows, **and Android**)". Android support is a merged PR (#5318, merged 2024-12-12, "Android support is 'almost there'… This is as far as I've managed to get it working"), and the feature flags `android-game-activity` / `android-native-activity` exist in `eframe`. `sagebind/egui-android` is an alternative backend that "removes winit as the middleman" because "While eframe *can* be used on Android, it does currently have certain limitations and missing features, primarily caused by winit". There is also a documented gap: issue #7478 asks for `SurfaceView` support to embed egui in a native Android UI; the maintainer answer is that this needs winit/the android-activity crate or a custom backend.
- `[inference]` Android TV (leanback/D-pad) is not a supported notion for egui; nothing in the docs or issue tracker addresses it.

### 4.5 Startup / memory / size
- egui is a Rust library compiled into the binary; no managed runtime, no bundled engine. I found **no official numbers** for startup time, RSS or binary size. Slint and Tauri publish comparison numbers (Slint's page contrasts its own compiled-to-native model with QML's JIT), and the toolkit is widely described as requiring minimal dependencies.

### 4.6 Precedent
- **Rerun** (rerun.io) — "Egui seems well suited to render even tens of thousands pointcloud with wgpu backend" (HN comment; Rerun is an egui-based viewer by egui's author's team). This is the strongest egui-at-scale precedent I found.
- **mpv/egui**: `egui-sharkplayer` (Unlicense, 0.5.1, first published 2026-06-18) — "A hardware accelerated video player for egui using libmpv"; its docs warn "libmpv2's render API only supports OpenGL… If at all possible, use `glow` and disable the `wgpu` feature".
- No egui-based media browser / HTPC app was found.

---

## 5. Qt6 / QML (scene graph)

### 5.1 Rendering model and frame budget
- Qt Quick is a retained-mode scene graph. Since Qt 6.0 "the default adaptation always renders via a graphics abstraction layer, the Qt Rendering Hardware Interface (RHI)… it records resource and draw commands by using the RHI APIs, which then translate the command stream into OpenGL, Vulkan, Metal, or Direct 3D calls", and the graph "will on most platforms be processed and rendered in a separate thread" (`doc.qt.io/qt-6/qtquick-visualcanvas-scenegraph-renderer.html`). Backends are selectable per app or via `QSG_RHI_BACKEND` (`OpenGL`, `Vulkan`, `Metal`, `Direct3D11`, `Direct3D12`, plus a Software adaptation).
- The budget is documented: "you typically strive to allow the rendering engine to achieve a consistent 60 frames-per-second refresh rate… approximately 16 milliseconds between each frame… never spend more than a couple of milliseconds per frame within blocking functions" (`doc.qt.io/qt-6/qtquick-performance.html`, Qt 6.12 docs).
- Qt's own performance page enumerates the classic pathologies: clipping is "a visual effect, NOT an optimization" and is "especially bad" inside a delegate; translucent content is slower than opaque ("An image with one translucent pixel is treated as fully translucent"); `ShaderEffect` "needs to run for every pixel"; and since Qt 6.8 the JS garbage collector is incremental ("shorter, but potentially more interruptions").
- Qt publishes **qmlbench** as its official QML/QtQuick frame-rate benchmark ("a decent metric for overall Qt performance", `github.com/qt-labs/qmlbench`), and has a Qt blog analysis "Qt 6.6 and 6.7 Make QML Faster than Ever: A New Benchmark and Analysis" (2023-12-19). I did not extract per-scenario numbers.

### 5.2 Long lists / decoding / caching
- `ListView` "will only load as many delegate items as needed to fill up the view", `cacheBuffer` retains extra instantiated delegates outside the visible area and creates them asynchronously across frames, with the explicit warning that "cacheBuffer is not a pixel buffer – it only maintains additional instantiated delegates" and that it "will only postpone issues caused by slow-loading delegates" (`doc.qt.io/qt-6/qml-qtquick-listview.html`).
- **Item pooling**: since Qt 5.15 `reuseItems: true` moves flicked-out delegates into a reuse pool (`pooled`/`reused` signals), "improves performance, depending on the complexity of the delegate". Qt 6.10 added `delegateModelAccess` (read-only vs read-write model access). `displayMarginBeginning/End` are explicitly "not a performance optimization".
- Variable-size delegates: "Variable delegate sizes might lead to resizing and skipping of any attached ScrollBar… can be set to higher values [cacheBuffer], effectively creating more items and improving the size estimate of unallocated items, at the expense of additional memory usage."
- Images: set `asynchronous: true` for local files ("remote images are always loaded asynchronously"), set `sourceSize` to the displayed size so the smaller-scaled version is kept in memory, and `image.smooth` only when required. `ListModel` is "useful for quick prototyping, but not suitable for larger amounts of data. Use a proper `QAbstractItemModel` where necessary", and dynamic roles are disabled by default because they make the model much slower.
- `[inference]` a poster wall is a `GridView`/`ListView` with a fixed-size delegate, `asynchronous: true`, `sourceSize` set to the cell size, `reuseItems: true`, and (if needed) a custom `QQuickImageProvider` decoding on a worker thread.

### 5.3 Focus / keyboard / gamepad
- Keyboard focus is a documented subsystem: `activeFocusOnTab`, `Keys`, `FocusScope`, and `KeyNavigation` ("enables this behavior by providing a convenient way to specify the item that should gain focus when an arrow or tab key is pressed", `doc.qt.io/qt-6/qml-qtquick-keynavigation.html`). `ListView` "is a focus scope" and has `keyNavigationEnabled` and `keyNavigationWraps`; built-in `StandardListView` (Qt Quick Controls) handles Up/Down/Page/Home/End inside a `FocusScope`'s `key-pressed`.
- **Gamepad: QtGamepad was not ported to Qt 6.** Qt's own porting material lists "Qt Gamepad: Functionality not sufficiently in demand" among Qt 5.15 features dropped in Qt 6. The community replacements are `pumphaus/qtgamepadlegacy` ("Qt5's QtGamepad module ported to Qt6", referenced on the Qt development list, 2025-05) and a newer QtSDL-based library ("Qt dropped the QGamepad library, listens to SDL gamepad events" — r/QtFramework, 2025-07). On Android TV, D-pad arrives as normal key events.
- On-screen keyboard: Qt has first-party virtual-keyboard integration for embedded and mobile; on desktop it is not needed. (Detail not verified in this pass — see §13.)

### 5.4 Platform reality
- Qt 6.12 LTS (2026-09-30) supports Windows, Linux (X11/Wayland), macOS, Android, iOS, embedded (Boot to Qt), and WebAssembly. Qt 6.12's "What's new" notes new embedded platforms (Orange Pi 2, NXP i.MX95, Qualcomm Dragonwing IQ6/IQ9, Renesas RZ/G3E), a new `QtQuick.Controls.Native` style, and for WebAssembly "Video frames are now uploaded to WebGL using texImage2D for zero-copy rendering when using Qt Quick".
- Licensing is dual: commercial, or open source "primary open-source license is the GNU Lesser General Public License v. 3 (LGPL)… some parts of Qt are only provided under GPL for open source users, not under LGPL" (qt.io licensing page). Video codecs etc. are a separate matter, and QtWebEngine (Chromium) has its own license/notices.
- Android/TV: Qt for Android is a supported Qt platform; Android TV would be an Android target plus leanback manifest work. `[inference]` Qt Quick Controls do not ship a "TV" style; a 10-foot UI is hand-built.

### 5.5 Startup / memory / size
- No first-party Qt numbers found for startup/memory. Real, verifiable artifact sizes for a Qt 6 + QtWebEngine + libmpv HTPC app (**Jellyfin Desktop v1.12.0**, the last release published before the v2.0.0 rename): Windows x64 installer **156.3 MB**, Windows x86 **119.9 MB**, macOS Apple Silicon dmg **186.2 MB**, macOS Intel dmg **204.1 MB**, and the Linux `.deb`s are **~0.5 MB** because they depend on the distribution's Qt 6 and mpv.
- The Qt QML runtime is dynamically linked; binary size is dominated by which Qt modules you ship (QtWebEngine being the largest). `[inference]`.

### 5.6 Precedent — the strongest in this document
- **Jellyfin Desktop** (`jellyfin/jellyfin-desktop`, renamed from `jellyfin-media-player`; GPL-2.0; 5,871★; last push 2026-08-31; **v2.0.0 in Dec 2025**): "Desktop client built with **Qt WebEngine and libmpv**… Media plays within the same window using the jellyfin-web interface", now on **Qt 6 + MpvQt**, with MPRIS, multi-profile, and "option to force using the HTML5 player". Its FreeBSD port's dependency list is concrete evidence of the stack: `libmpv.so`, `libMpvQt.so`, `libcec.so` (HDMI-CEC), `libQt6Qml`, `libQt6WebEngineCore`, SDL2.
- **KDE's MpvQt** (`KDE/mpvqt`, 29★, pushed 2026-10-15, LICENSES dir contains LGPL-2.1-only / LGPL-3.0-only / MIT / BSD-3-Clause / CC0) is the library Jellyfin now uses: "MpvQt is a libmpv wrapper for Qt Quick 2/QML"; you subclass `MpvAbstractItem` (a `QQuickFramebufferObject`) and use it as a QML element. Its README lists **Haruna** and **PlasmaTube** as apps using it.
- **Kodi** (`xbmc/xbmc`, **GPL-2.0-or-later**, 21,327★, 21.3-Omega 2025-10-31, pushed 2026-10-15) is not Qt: it is its own C++ UI toolkit rendering with OpenGL/OpenGL ES/Direct3D, with "Dirty-Regions rendering" and its own skinning engine. It is the "you can just build the toolkit" existence proof at HTPC scale; the wiki's application-size figure is "generally only takes up between 100 to 200 MB of space".
- **Stremio desktop shell** (`Stremio/stremio-shell`, "Qt5-based shell… compile this to run the desktop app", GPL-3.0, last release tag `4.4.107` in **2020**, last push 2026-03-27) — a long-lived, mostly-maintained Qt shell for a Stremio client.
- **jellyfin-mpv-shim** (`jellyfin/jellyfin-mpv-shim`, Python + mpv; 2,489★; v3.1.0 2026-10-05; pushed 2026-10-14; **no SPDX license detected by the GitHub API**) — a tray/shim client; Jellyfin's own write-up notes it is controllable from the phone and that Jellyfin Media Player "can be controlled with some remote controls, game controllers, and media keys through jellyfin-web's TV display mode".

---

## 6. Compose Multiplatform desktop (Skia)

*Note: everything in §6 about "Compose for TV" is the **Android** target (`androidx.tv.*`). Compose Multiplatform desktop is a JVM/Skia target and does not have a TV D-pad layer of its own.*

### 6.1 Rendering model and frame budget
- Rendering is Skia via **Skiko**. JetBrains' own release notes for the DirectX-12 renderer (Compose for Desktop milestone 3) state: "By default, it uses an OpenGL-based renderer on macOS and Linux, and (now) a DirectX-based renderer on Windows", with automatic fallback to OpenGL and then to software, and "this fallback renderer is significantly slower than its hardware-accelerated counterpart (**up to 4 times slower**)". Renderers can be forced with `SKIKO_RENDER_API="SOFTWARE"` / `"OPENGL"` (and the docs/dev forum mention Software/OpenGL/Vulkan/Metal backends generally).
- Compose's own frame model is documented on Android (Baseline Profiles, frame tracing); for desktop I found no first-party fps budget table.
- A strong, but **self-reported**, data point exists for "full-screen UI over a video surface" in Compose: the `mediamp` mpv desktop backend commit (94f5038, PR #37) says it "delivers a production-ready mpv playback backend for desktop — macOS and Windows, hardware-accelerated and zero-copy into the Compose scene graph", with a triple-buffered ring of NT-handle shared textures opened as `ID3D12Resource` on Skia's D3D12 device, and "reaching **~240fps at 4K under a full-screen danmaku overlay**, with no resize crash". Treat as the project's claim (see §13).

### 6.2 Long lists / decoding / caching
- `LazyRow`/`LazyColumn`/`LazyVerticalGrid` are the standard lazy layouts (inherited from Jetpack Compose, available on desktop). Compose for TV adds `TvLazyRow`/`TvLazyColumn` with focus-aware `TvLazyListLayoutInfo`.
- Image loading in multiplatform Compose is **Coil 3** (`io.coil-kt.coil3:coil-compose`, MIT): "Full support for Compose Multiplatform including all major targets (Android, iOS, JVM, JS, and WASM)"; on non-Android targets you must add a network artifact (Ktor) and `kotlinx-coroutines-swing` on JVM. Coil's own docs advise against `SubcomposeAsyncImage` in performance-critical parts of a `LazyList` ("Subcomposition is slower than regular composition").
- Documented pathologies: **coil#3379** "AsyncImage requests cancelled in LazyRow are not always restarted when item becomes visible again" (reported on Coil 3.2.0 and 3.1.0; the preview stays empty intermittently during fast back-and-forth scrolling), and **coil#2584** "Performance issue in compose" — a maintainer-guided report from someone targeting **low-end TV boxes**: "it is very laggy (especially if the image aren't in cache)… The behavior in LazyRow and LazyColumn works kind of well… The main issue is in the grid." The thread's resolution list is a good summary of the platform's sharp edges: use release builds, R8 full mode, avoid `SubcomposeAsyncImage`, `remember {}` the `ImageRequest`s; and the reporter later wrote "After testing Coil 3.1.0… the experience feels just as good in Coil as it does in Fresco."
- Compose 1.12.0 (2026-08-25) added `LayerOutsets`/`MeshGradientPainter`; 1.13.0-alpha01 (2026-09-10) lists "Implemented support for **AppCDS** and **AOT**, which can significantly speed up application startup" (desktop) and "Added **prefetching of `LazyLayout` items** during browser idle times" (web).

### 6.3 Focus / keyboard / gamepad
- Compose has a focus system in `commonMain`: `FocusRequester`, `Modifier.focusRequester`, `focusGroup`, `focusRestorer`, `onFocusChanged`, `onKeyEvent`/`onPreviewKeyEvent`. Compose MP 1.11.0 (2026-05-13) added **tvOS Siri Remote button events (Select, Menu, Play/Pause)** (#2717) — that is the Apple TV target, not Android TV.
- **Android TV is genuinely first-party**: `androidx.tv:tv-material` reached **1.0.0 stable on 2024-08-21** (1.0.1 on 2025-07-16; 1.1.0 exists), "Compose for TV works on Android TVs with Android 5.0 (API level 21) or higher", and Google's docs describe `TvLazyRow`/`TvLazyColumn`, `ImmersiveList`, `Carousel`, `focusableItem`, `FocusEnterExitScope`, plus material-designed `TvLazy*` layout info (`developer.android.com/jetpack/androidx/releases/tv`, `developer.android.com/training/tv/playback/compose`).
- Media3's own Android TV guidance shows the kind of glue TV work needs: D-pad `KeyEvent`s must be forwarded to `PlayerView` (`dispatchKeyEvent`), or when using Compose you must mark the `AndroidView` focusable and forward `it.nativeKeyEvent`, or use the `Player` composable which "ha[s] an automatic `FocusRequester` instance that traverses the components with the D-pad" (`developer.android.com/media/media3/ui/androidtv`).
- Desktop D-pad: not a Compose concept. `[inference]` you would implement directional focus yourself with `FocusRequester` + `onKeyEvent`, or reuse `androidx.tv` only on the Android target.

### 6.4 Platform reality
- Documented minimum targets (kotlinlang.org, "Compatibility and versions", page dated 2026-06-02): Android 5.0 (API 21), iOS 14, **macOS 13 arm64**, Windows 10 (x86-64, arm64), Linux Ubuntu 20.04 (x86-64, arm64), Web requiring WasmGC. Note that **macOS is listed for arm64 only** — `[inference]` Intel macOS is no longer a listed supported desktop target.
- Desktop requires JDK 11+ "due to the memory management scheme used in Skia bindings"; Kotlin Multiplatform IDE support for desktop development is on Linux/Windows/IntelliJ plus macOS for Apple targets.
- The Android TV target is a normal Android target, so the same `commonMain` UI code can compile to it, but any TV-specific composable comes from `androidx.tv.*`, which does not exist for the desktop target.

### 6.5 Startup / memory / size
- The JVM is the tax: no numbers published by JetBrains for Compose Desktop cold start or RSS that I could find; the mitigations they have shipped are AppCDS + AOT ("can significantly speed up application startup", #5644, landed in **1.13.0-alpha01**, i.e. **not** in stable 1.12.2), ProGuard minification in release builds (default rules provided), and Compose Hot Reload for dev.
- Real app: **coveninja/cove v1.6.0** (Compose Multiplatform, AGPL-3.0, 150★): `cove-windows-amd64-portable.zip` **195.4 MB**, `cove-windows-amd64-setup.exe` **164.0 MB**, `cove-linux-amd64.tar.gz` **152.0 MB**, `cove-linux-amd64.flatpak` **142.8 MB**, `cove-macos-arm64.dmg` **195.9 MB**, `cove-android.apk` **136.6 MB**. For reference, Flutter's Fladder equivalents are 36–89 MB (§2.5) and Qt's Jellyfin Desktop Windows installer is 156 MB (§5.5), so a Compose MP desktop bundle is in the same order of magnitude as QtWebEngine and ~2× the Flutter bundle.

### 6.6 Precedent
- **coveninja/cove** (AGPL-3.0, 150★, v1.6.0 2026-10-09, Kotlin): "A media streaming app for Linux, Windows, macOS, Android & Android TV. Discover, track, and stream movies and TV shows – powered by TMDB metadata, Stremio & Nuvio compatible addons & plugins, and a built-in mpv player."
- **open-ani/mediamp** (Apache-2.0, 149★, created 2024-12-07, pushed 2026-10-15) is the video layer for Compose MP: platform table in its README lists Android→ExoPlayer, **JVM Windows/macOS/Linux→MPV** (the README text still says VLC; the desktop mpv backend landed as commit 94f5038), iOS→AVKit, browser→HTMLVideoElement, and "The VLC backend is deprecated and no longer maintained; MPV replaced it as the desktop backend in state spec v2."
- **Chaintech-Network/ComposeMultiplatformMediaPlayer** exists as a packaged player for CMP ("for desktop video player, ensure VLC Player is installed").
- JetBrains' own example player on desktop historically used `SwingPanel` + VLCJ, which is the source of the interop problems in §11.

---

## 7. Slint

### 7.1 Rendering model and frame budget
- Slint's renderers (`docs.slint.dev`, "Backends & Renderers"): **Qt renderer** (QPainter, software, Qt backend only), **Software renderer** (partial/line-by-line updates, microcontroller-friendly, some features missing), **FemtoVG** (GPU via OpenGL, or Metal/Vulkan/Direct3D when selected as `renderer-femtovg-wgpu`), **Vello** ("GPU acceleration with Metal, Vulkan, and Direct3D… **Experimental**: it's never selected automatically… Requires a GPU that supports compute shaders. There's no software fallback"), and **Skia** ("Sophisticated GPU acceleration with OpenGL, Metal, Vulkan, and Direct3D… Heavy disk-footprint compared to other renderers").
- Backend selection: developer-provided → `SLINT_BACKEND` env var → `qt`, then `winit`, then `linuxkms`. Renderer and backend combine as `SLINT_BACKEND=winit-software`, `winit-vello`, `linuxkms-skia`, etc.
- No first-party fps benchmark was found. Vendor claims on slint.dev: "The Slint runtime fits in less than 300KiB RAM", "Slint compiles your UI design to machine code", and a Qt comparison page arguing against QML's runtime interpretation/JIT and GC pauses ("Avoid unpredictable garbage collection pauses and JIT compiler performance cliffs"). These are vendor statements, not measurements.

### 7.2 Long lists / decoding / caching
- The `ListView` docs are explicit: "In a ListView, elements are only instantiated if they are visible, which guarantees stable performance with a practically unlimited number of items. **ScrollView is more suitable for free-form content**", and the ScrollView docs warn "A ScrollView will always instantiate all of its children, so its performance may degrade with large number of children, even if they are not visible."
- Items only exist while visible, and `Model::row_data(row)` is called only for visible rows (issue #4561, "example which demonstrate how to scale using ListView"): "Only the visible row will call Model's `row_data`". That thread is also the clearest statement of the gap: someone asks for a lazy model with `prefetch_row`/`release_row` so that heavy rows can be freed; the maintainers' answer is that this belongs in a custom `Model` (and prefetching must be done by the model itself). Issue **#4116** "feature: infinite list" is the corresponding feature request.
- Known pathology: if you replace the whole model (`set_datas(model.into())`) instead of mutating it (`model.push(...)`, `set_row_data(...)`), "it will be reloaded completely each time what ends up in a bad performance" (slint issue #4097, maintainer answer). A blog post "Writing an FX rates viewer with Rust and Slint" (2025-10-10) documents the working pattern from an external user: `ListView` + a custom `slint::Model` over a `HashMap` with a prefetch window `[N-10, N+20]`, in-flight-request dedupe, `ModelNotify::reset()`, and `slint::spawn_local`, calling the result "a truly egregious amount of boilerplate for one line of database query".
- Image decoding/caching: no first-party image-cache story found (see §13).

### 7.3 Focus / keyboard / gamepad
- `FocusScope` + `KeyBinding` + `key-pressed`/`key-released` with an explicit delivery order: "Key events are delivered to the element that `has-focus`… checked whether some other element wants to intercept the `KeyEvent`… delivered to the focused element… If these callbacks return `EventResult::accept`, then event delivery is finished… Otherwise, (recursively) try to deliver the key event to the parent element." There is `focus-on-tab-navigation`, `focus()`/`clear-focus()`, and `focus-changed-event(reason: FocusReason)`.
- The built-in `StandardListView` (in the common widget set) already implements arrow-key/Page/Home/End/space navigation *and* a `current-item`/`selected` model with `bring-into-view` — i.e. keyboard list navigation is shipped, not DIY. Its `key-pressed` handler accepts `Key.UpArrow`, `Key.PageUp`, `Key.Home`, `Key.DownArrow`, `Key.PageDown`, `Key.End`, `Key.Space`.
- **Gamepad: nothing found.** No gamepad/TV-remote abstraction appears in the docs; a gamepad would have to be mapped onto keys by the host application (`[inference]`).

### 7.4 Platform reality
- Slint targets desktop (Windows/macOS/Linux), mobile, web and embedded/bare-metal. **Android is official**: "Slint 1.5: Embracing Android… Enable the `backend-android-activity-05` feature of Slint to seamlessly develop applications for Android devices. Under the hood, this feature uses the android-activity crate", described by Slint as "the only Rust GUI toolkit to officially support Android". The current feature is `backend-android-activity-06`; the entry point is `android_main`, the crate type must be `cdylib`, and `slint::android::init` / `init_with_event_listener` are the entry points (`docs.slint.dev` Rust Android module). Slint's maintainer states IME is implemented in Java inside Slint's Android backend ("Slint uses the NativeActivity by default, but it supports IME by implementing the IME support in Java in the Slint's android backend").
- There is also a **LinuxKMS backend** ("Linux's KMS/DRI infrastructure is used for rendering. No windowing system or compositor is required") which is unusual among these toolkits and relevant to HTPC/kiosk boxes.

### 7.5 Startup / memory / size
- Vendor claim: runtime < 300 KiB RAM; the software renderer "runs anywhere, highly portable, and lightweight" and supports partial/line-by-line rendering; the Skia renderer is called out as a "heavy disk-footprint" option. No third-party startup/RSS/binary-size numbers found for a real Slint app.

### 7.6 Precedent
- **No shipped media/HTPC app on Slint was found.** The publicly documented deployments are industrial/embedded HMIs (SK Signet EV-charger HMI "transitioned their HMI… from Qt to Slint"; Jasic Technology HMI; a QNX/Rust deployment), plus community demos. `[inference]` Slint has the least media-app track record of the toolkits in this list.

---

## 8. Avalonia

### 8.1 Rendering model and frame budget
- Avalonia is retained-mode with a scene graph and a **compositor**: frame lifecycle is input → property changes → layout (measure/arrange) → render pass ("Controls with dirty visuals rebuild their portion of the scene graph via `Render(DrawingContext)`; the framework diffs the new scene against the previous one") → composition ("the compositor takes the updated scene graph and submits draw calls to the GPU backend (Skia or the platform's native compositor)").
- **The documentation contradicts itself on the default**, and I report both statements verbatim:
  - `docs/fundamentals/architecture` (updated 2026-10-01): "**Software composition**: The scene graph is rasterized on the CPU using Skia, then blitted to the platform window. **This is the default on most platforms** and works everywhere. **GPU composition**: Where the platform supports it (e.g., Direct3D on Windows, Metal on macOS, OpenGL/Vulkan on Linux)…"
  - `docs/app-development/performance` (updated 2026-09-21): "**Avalonia uses Skia with GPU acceleration by default.** Skia maintains a GPU resource cache for textures and other GPU-backed surfaces. The default cache limit is approximately **28 MB**. If your app works with large images… images that exceed the cache limit are **re-uploaded to the GPU each frame**, which can cause stuttering."
  `[inference]` the performance page describes the shipping default and the architecture page's sentence is stale or refers to a fallback posture; either way, the practical rule for an image wall is the documented 28 MB GPU cache and its per-frame re-upload consequence.
- Avalonia's own blog ("The Future of Avalonia's Rendering", "Vello POC") says "SkiaSharp isn't going anywhere, it remains our default and will be fully supported for years. But we're exploring GPU-first rendering" (Vello, a Rust GPU-first renderer).
- A credible negative data point: Avalonia issue **#21213**, "Avalonia compositor is too slow for real time rendering" (opened 2026-04-19, labelled `area-rendering`/`enhancement`, **open**), on Avalonia 12.0/Windows: "Testing the same scene which runs at 100fps on a native window, avalonia renders it at 50fps. I also measured internal frame time instead of just total time between frames, it was 11ms (~90fps) which shows it is just an issue with the compositor updates… I tested WPF, and it runs at 60FPS on that same scene so it is quite faster than avalonia." The same thread complains that on Windows the only GPU path is ANGLE/OpenGLES ("why are we forced to use Angle OpenGLES, and WGL is unusable?").
- `[inference]` for a *static-ish* UI (poster wall that scrolls) the compositor's real-time-GPU-workload weakness (#21213) is a different risk from what this project needs; there is no first-party fps benchmark to settle it.

### 8.2 Long lists / decoding / caching
- UI virtualization is documented: `ListBox` virtualizes by default; `VirtualizingStackPanel` supports `BufferFactor` ("realizes items across one extra viewport height above and below the visible area. The default is 0 (no buffer)"); virtualization requires a constrained height ("**DON'T**: `StackPanel` gives infinite height, disabling virtualization").
- **Variable-height items are called out as the pathology**: "`VirtualizingStackPanel` is optimized for collections where all items have the same height. The panel estimates scroll extent based on number of items, meaning collections containing items with variable heights **can cause scroll bar jumps and layout recalculations**." Recommendations: uniform height, flatten hierarchical data, or limit realized items.
- Images: `RenderOptions.BitmapInterpolationMode="LowQuality"` for thumbnails; `BitmapCache` with `RenderAtScale`/`SnapsToDevicePixels`/`EnableClearType` for expensive-but-static visuals; `IsHitTestVisible="False"` to cut the linear hit-test walk ("This linear walk can cause a noticeable delay between clicking and receiving the event if a control contains many children"); `ClipToBounds` only when needed; `MaxGpuResourceSizeBytes` to raise the 28 MB default.
- Avalonia 12 turns **compiled bindings on by default** ("Compiled bindings resolve property paths at compile time, avoiding runtime reflection. They are enabled by default from Avalonia version 12") and disables region dirty-rect clipping by default "to minimize loss of frame rate".

### 8.3 Focus / keyboard / gamepad
- Focus and tab navigation exist (`FocusManager`, `IsTabStop`, `IsHitTestVisible`, keyboard events); the docs' performance page is largely about layout/rendering, not input mapping. **No gamepad or TV-remote support is documented.** `[inference]` D-pad would be hand-built (or via SDL) exactly as on Qt.

### 8.4 Platform reality
- Supported platforms page: "Avalonia apps can target Windows, macOS, Linux, iOS, Android, and WebAssembly", organised into tiers. Linux: "Avalonia targets X11 directly on Linux. **A native Wayland backend is available as an experimental opt-in package starting with Avalonia 12.1.0**"; embedded Linux via framebuffer or DRM, with Raspberry Pi OS at Tier 1. Avalonia also has an embedded/native WebView component (open-sourced in v12, using each platform's native web renderer).
- Android support is being rebuilt in v12 ("Avalonia 12 lands a rebuilt Android backend").

### 8.5 Startup / memory / size
- No first-party numbers found. `[inference]` a .NET app's cold start and RSS are dominated by the runtime; the Avalonia performance page's own guidance (batch large collection updates, `DispatcherPriority.Background`, incremental loading) reads like a toolkit whose measurement story is "profile it yourself with dotTrace/dotMemory and the DevTools Performance tab".

### 8.6 Precedent
- **No media/HTPC app on Avalonia was found.** The relevant artifacts are community video plumbing: `mysteryx93/LibMpv-OpenGL` ("Cross-platform MPV video player library for .NET, with an **Avalonia 12** implementation supporting Windows, macOS, and Linux… It works in desktop (Windows & Linux) in all 3 rendering modes: **Software, OpenGL, Native**"), `LibVLCSharp.Avalonia`, and a commercial "Avalonia Media Player" control (avaloniaui.net/media-player, free trial) that "uses the native platform back-end" per platform.
- Avalonia's known production user base is developer tools; I did not verify a specific flagship app in this pass (see §13).

---

## 9. Iced

### 9.1 Rendering model and frame budget
- Iced 0.14.0 (released 2025-12-07; MIT) ships "Two built-in renderers… `iced_wgpu` supporting Vulkan, Metal and DX12 [and] `iced_tiny_skia` offering a software alternative as a fallback", plus a renderer-agnostic native runtime. The README says "**Iced is currently experimental software.**"
- 0.14's release highlights (Phoronix, "Iced 0.14 Released For Popular Rust Cross-Platform GUI Library"): "reactive rendering, time-travel debugging support, headless testing capabilities, input methods support, **concurrent image decoding and uploading**, hot reloading support, smart scrollbars". The changelog also lists "Primitive culling in `column` and `row` widgets", "Basic layer merging for `graphics::layer::Stack`", "`crisp` feature for default quad snapping", and "Lazy `Compositor` initialization in `winit` shell".
- The commonly cited performance caveat is GPU burn from full-view rebuilds: "GPU cycles: Iced redraws the entire view every time your state changes which was burning GPU. You can prevent this by using the `Lazy` widget" (r/rust, Iced 0.14 thread). No first-party fps budget or benchmark table was found.

### 9.2 Long lists / decoding / caching
- There is a `lazy` widget: "Creates a new `Lazy` widget with the given data `Dependency` and a closure that can turn this data into a widget tree" (`iced::widget::lazy`, feature `lazy`, `Dependency: Hash`). It is a memoisation boundary, not a viewport virtualiser: there is no documented virtualising list widget for an image wall.
- `scrollable` exists; `iced_wgpu` decodes and uploads images concurrently since 0.14. `[inference]` virtualising a poster wall means computing the visible range yourself and only emitting those `Lazy` nodes.

### 9.3 Focus / keyboard / gamepad
- Focus primitives exist (`iced::advanced::widget::operation::focusable` with `focus`, `unfocus`, `is_focused`; `focus_next`, `focus_previous`; the `Focusable` trait), but coverage is thin: the third-party `iced_focus` widget's README says "**Iced doesn't have much support for focusable elements yet.** The primitives are there with `operation::Focusable` and `focus_next`/`focus_previous`, but the only widgets implementing focus today are `TextInput` and `TextEditor`." Per docs.rs, only `iced::widget::text_editor::State` and `text_input::State` implement `Focusable`.
- No gamepad/TV-remote support found.

### 9.4 Platform reality
- Documented platforms: "Cross-platform support (Windows, macOS, Linux, and the Web)". **No mobile target** appears in the README's platform list. `iced_tiny_skia` gives a CPU fallback (useful on odd Linux/remote-display setups).
- Main real-world consumer: the **COSMIC desktop environment** (Phoronix: "the COSMIC desktop is the likely most notable user").

### 9.5 Startup / memory / size
- No first-party numbers. `[inference]` a Rust + wgpu binary is in the same class as egui/Slint for startup and size; the dependency footprint noted by `iced_video_player`'s lib.rs page is "~63–86 MB, ~1.5M SLoC" for the GStreamer-backed variant.

### 9.6 Precedent
- **No media/HTPC app on Iced was found**, and the one publicly documented attempt to build one went the other way: the DEV post "Integrating MPV Video Player into Rust-Based Cinebox GUI for Cross-Platform 4K HDR Support" describes starting with "Iced with wgpu (DirectX on Windows) and mpv rendering via Vulkan", hitting "**No shared surface between mpv and Iced**", and being "forced… into its own window, embedded inside the app. While functional, it blocked UI overlays like controls or subtitles, as painting over an external window is impossible." The only public video widget, `jazzfool/iced_video_player` (0.6.0, Dec 2025), is built on **GStreamer**, not libmpv, and "copies frame data directly to a WGPU texture, and renders using a custom WGPU render pipeline"; its own issue #5 discusses the zero-copy interop gap and says "instead of using `glimagesink` at that point I would consider switching entirely from gstreamer and instead to libmpv".

---

## 10. GPUI

### 10.1 Rendering model and frame budget
- GPUI is Zed's in-house hybrid immediate/retained GPU UI framework: "GPUI is a hybrid immediate and retained mode, GPU accelerated, UI framework for Rust"; "GPUI is still in active development as we work on the Zed code editor, and is still pre-1.0. There will often be breaking changes between versions." (`docs.rs/gpui-unofficial`). Rendering APIs: Metal on macOS, Vulkan on Linux (originally blade-graphics; the Linux renderer was reimplemented on **wgpu** on main, PR #46758 merged 2026-02-13, per the companion doc), Direct3D 11 on Windows.
- The only public performance evidence is Zed's own blog posts: "**Leveraging Rust and the GPU to render user interfaces at 120 FPS**" (2023-03-07) — "a modern display's refresh rate ranges from 60 to 120 frames per second, which means an application only has 8.33ms per frame" and Zed "is rendered like a videogame" — and "**Optimizing the Metal pipeline to maintain 120 FPS in GPUI**" (2024-02-07), which is about *keeping* 120 Hz via `CADisplayLink`/`on_request_frame` and re-presenting frames for 1 s after input. Zed's marketing repeats "120 frames per second scrolling" and "half-second cold start".
- Caveat to carry: the 120 fps claims predate Zed shipping on Linux and Windows, and come from the framework's own vendor.

### 10.2–10.3 Lists, focus, gamepad
- Zed internally uses virtualised list primitives for its editor and panels, but I found **no public documentation** of a GPUI list/virtualisation API in this pass (see §13).
- Key dispatch *is* documented (`gpui.rs` → `key_dispatch.md`, plus `contexts.md`), and the crate has ~30 bundled examples. Accessibility landed 2026-05-27 (AccessKit, PR #56065, on main, not released).
- No gamepad/TV-remote support found.

### 10.4 Platform reality
- macOS, Linux (X11 + Wayland), Windows are all first-class today; Zed's Windows GA was 2025-10-15 (per the companion doc). No mobile.
- The framework's future is the live risk: a Zed maintainer announced on Hacker News (linked from a 2026 discussion) "GPUI development is getting some major brakes put on it. We gotta focus on some business relevant work in 2026, and so I'm going to be pushing off anything that isn't directly related to Zed's use case from now on", pointing at a former employee's side repo for continued work. The `gpui` crate on crates.io has been stuck at **0.2.2 (2025-10-22)** despite large changes on main; the versions people actually consume are published by a third party (`gpui-gpui-unofficial`, 1.24.x).

### 10.5 Startup / memory / size
- No first-party numbers for the framework; Zed's app-level numbers are marketing (cold start ~0.5 s, 200–400 MB RSS vs VS Code) reported by third-party articles, not Zed's own measurements in this pass.

### 10.6 Precedent
- **Zed is the only production user.** The one public media artifact is `gpui-video-player` (MIT, 0.1.2) — "A video player library for gpui applications, **built on top of GStreamer**". No libmpv-in-GPUI project and **no documented public API in gpui for handling an external GPU texture / native video surface** was found (see §13).

---

## 11. Cross-cutting: custom UI rendered in the same window as native video

This is the pattern that decides the in-player overlay. Ranked by how much the toolkit fights you.

| Toolkit | Verdict | Evidence |
|---|---|---|
| **Qt6/QML** | **Supported, first-class.** Video is just another scene-graph item; you can draw arbitrary QML on top. | `VideoOutput` is an `Item` (`doc.qt.io/qt-6/qml-qtmultimedia-videooutput.html`); the libmpv path is `QQuickFramebufferObject` + `MPV_RENDER_API_TYPE_OPENGL` (`mpv-examples/libmpv/qml`, whose `main.qml` is literally "QtQuick and mpv are both rendering stuff" with a MouseArea/Rectangle/Row/Slider over the video); KDE `MpvQt` does this for a shipped app; `jellyfin-desktop` "Media plays within the same window using the jellyfin-web interface". mpv's own examples README prefers the render API over window embedding: "using the render API is currently recommended over window embedding" and the Qt/OpenGL variant "does not rely on embedding 'foreign' native Windows… You can do your own OpenGL rendering on top of the video as well." |
| **Flutter** | **Supported, documented, shipped.** Flutter's compositor accepts an external GPU texture as a first-class object. | `media_kit_video` uses "Flutter's Texture Registry API & libmpv's OpenGL rendering API": Windows via `ANGLESurfaceManager` + `ID3D11Texture2D` → `FlutterDesktopGpuSurfaceDescriptor`; Linux via `GdkGLContext` + `FlTextureGL`/`FlTextureRegistrar`; Android via `--wid` on a `Surface` from Flutter's `SurfaceTextureEntry`; software fallbacks via `FlPixelBufferTexture`. (Detail in the companion doc §6.) |
| **Avalonia** | **Supported** by design. | "GPU interop with composition surfaces… For advanced scenarios such as **video playback**, 3D engine integration, or cross-process GPU texture sharing, Avalonia's composition API supports importing external GPU resources into a `CompositionDrawingSurface`" (`docs.avaloniaui.net/docs/graphics-animation/custom-rendering`); plus `OpenGlControlBase` and `CompositionCustomVisualHandler` ("renders the shader independently of the main UI thread"). Working libs: `LibMpv-OpenGL` "works in desktop (Windows & Linux) in all 3 rendering modes: Software, OpenGL, Native". |
| **egui** | **Supported via the render API → texture.** | `egui_glow::Painter::register_native_texture`, `egui_glow::CallbackFn`, `egui-wgpu` `CallbackTrait` + `register_native_texture`/`update_texture`; `egui-sharkplayer` is a libmpv player for egui (glow preferred, wgpu roundtrips through system memory). Companion doc §4. |
| **Compose Multiplatform (desktop)** | **Possible, but either hacky or Skiko-internals deep.** | The documented interop (`SwingPanel` + VLCJ) breaks layering: issue **#1087** "Box doesn't overlap" ("VideoPlayer always on top level of the screen… The webview is a SwingPanel, everything else is Compose… the webview stands above everything, cutting off any Compose content") and issue **#4389** where JetBrains answers: "It's a known limitation and out of Compose control… In the case of Windows – it does NOT alpha blend two views that rendered directly on GPU/DirectX, the top one just replaces the previous… There is a workaround for this – you need to render your component (video) off-screen (to texture first) and draw it via Swing graphics. It has some performance drop", shipped behind `compose.interop.blending` (and a later "flag now enabled by default" entry appears in one release's notes). The clean path is the `mediamp` approach: share the decoded frame as a GPU texture with Skia (macOS IOSurface ↔ Metal, Windows D3D11 ring → D3D12 on Skia's device; the commit notes it reflects into Skiko internals — `MetalRedrawer`, `MetalAdapter.ptr` — and calls for an official "external texture into Compose scene" API). |
| **Iced** | **Not demonstrated; the one attempt failed on surfaces.** | `iced_video_player` renders GStreamer frames into a wgpu texture via a custom pipeline (so overlay *ought* to work), but the Cinebox write-up describes abandoning iced+mpv because "No shared surface between mpv and iced… it blocked UI overlays like controls or subtitles, as painting over an external window is impossible." |
| **Slint** | **No documented path found.** | Nothing in the renderer docs, `ListView` docs or the platform docs describes handing Slint an external video texture or surface. See §13. |
| **GPUI** | **No documented path found.** | The only public GPUI video widget (`gpui-video-player`) uses GStreamer; no public "external texture" API was found in the published crate. See §13. |
| **Tauri 2** | **Hackery on every platform, and impossible in one notable case.** | Linux: #9220 was **closed as not planned** (opened 2024-03-19, closed 2024-03-28) — maintainer: "we are using GTK to create the window… when you add wgpu on top of it, they both fight on the same x11 surface hence the flickering, we can't really do anything to fix this as we need to use GTK for webviews… it is not possible on Wayland at all… Can you draw OpenGL into GTK? yes you can combine `gtk::Fixed` a `gtk::GlArea` widget and then add the webview widgets on top of it." #8246 ("Render WebView on Top of Native GPU Rendered Content") was closed 2024-03-28 with: "v2 beta has an `unstable` cargo feature… allow you to create a window and multiple webviews as children, so you can render OpenGL (or similar) on the window and place a webview on top of it. This however has limitation on X11… Here is an example: https://github.com/FabianLars/tauri-v2-wgpu". The wry GTK multi-webview example exists and does work — but it demonstrates **several webviews in one `gtk::Fixed`**, not video; and the non-GTK variant of that example explicitly `panic!("This example doesn't support wayland!")`. Windows needs a native child HWND plus click-through (`lukr54/airspace`, Apache-2.0, created 2026-07-26, solves it with `SetWindowRgn` hole-punching measured from the live DOM) and there is still an open request for click-through webviews (`#10564`, open since 2024-08-11). The escape hatch everyone uses is a second, transparent, click-through window: `PSG-Team/tauri-steam-overlay-surface` requires `tauri = { version = "2", features = ["unstable"] }` and runs a "decoy" window with an empty swapchain. `get-air/tauri-video-plugin` documents the Linux variant: "Both render through a native GTK GPU widget below the transparent WebView. The plugin installs a `GtkOverlay` around Tauri's original window child", and notes it must patch `tauri-runtime-wry` for an unsafe GTK-ancestry downcast fixed upstream in tauri #15701. |

Summary sentence for the requirement "custom UI in the same window as native video": **Qt/QML and Flutter do it natively; Avalonia and egui do it with a texture bridge; Compose MP can do it but has to go through Skiko internals (or accept Swing/interop layering limits); Iced, Slint and GPUI have no demonstrated path; Tauri requires per-platform hackery (child-HWND/region tricks on Windows, `GtkOverlay`/`GLArea` on Linux, decoy windows elsewhere) and cannot do the raw-X11-child trick on Wayland at all.**

---

## 12. Real-world precedent at this scale

| App | Toolkit | License | Start / last release | Maintained | What it proves |
|---|---|---|---|---|---|
| **Jellyfin Desktop** (ex `jellyfin-media-player`) | Qt 6 + QtWebEngine + libmpv (MpvQt) | **GPL-2.0** | created 2021-04-04; v2.0.0 Dec 2025; pushed 2026-08-31; 5,871★ | Yes | Web-based 10-foot UI + libmpv in one window; MPRIS; multi-profile; HDMI-CEC (`libcec`) |
| **jellyfin-mpv-shim** | Python + mpv (+ tray) | API reports no SPDX (repo has a LICENSE) | v3.1.0 2026-10-05; pushed 2026-10-14; 2,489★ | Yes | A shim is cheap to maintain; phone-driven control |
| **Kodi** | own C++ toolkit, GL/GLES/D3D | **GPL-2.0-or-later** | 21.3-Omega 2025-10-31; pushed 2026-10-15; 21,327★ | Yes | Custom toolkit + skinning engine is a viable HTPC answer; app is ~100–200 MB; D-pad-first by design |
| **Stremio desktop shell** | Qt5 (QWebEngine) | **GPL-3.0** | last release tag 4.4.107 (2020); pushed 2026-03-27; 928★ | Partially | A Qt shell for a Stremio-like client has survived for years |
| **Stremio shell-ng** | Rust + WebView2/mpv | GitHub API reports no license | v5.0.26 2026-09-22; pushed 2026-10-13; 91★ | Yes | Webview + mpv shell, actively shipped; no published assets |
| **9000000/harbor** | Tauri 2 + React + libmpv | **MIT** | created 2026-06-04, last push 2026-06-04; 3★ | No (parked) | The Tauri+libmpv shape works but is fragile (three per-platform mechanisms) |
| **ventic/ventic** | Nuxt + Tauri 2 + real mpv window | **MIT** | v0.7.5 2026-10-11; pushed 2026-10-15; 177★ | Yes | Desktop **and** Android from one Tauri codebase; separate mpv window (no overlay) |
| **coveninja/cove** | Compose Multiplatform + mpv | **AGPL-3.0** | v1.6.0 2026-10-09; pushed 2026-10-09; 150★ | Yes | A Stremio-like client on Compose MP shipping Windows/Linux/macOS/Android, incl. Android TV |
| **Fladder** | Flutter | **GPL-3.0** | v0.11.1 2026-09-08; pushed 2026-09-18; 2,656★ | Yes | Flutter Jellyfin client with Android+TV builds; maintainer acknowledges TV performance caveats |
| **plezy** | Flutter | **GPL-3.0** | created 2025-10-21; pushed 2026-10-15; 3,751★ | Yes | A popular Flutter Plex+Jellyfin client |
| **open-ani/mediamp** | Compose Multiplatform | **Apache-2.0** | created 2024-12-07; pushed 2026-10-15; 149★ | Yes | The community's Compose-MP video layer; desktop mpv backend landed zero-copy into the Compose scene graph |
| **Haruna / PlasmaTube** | Qt/QML + MpvQt | (not checked) | — | — | Named by MpvQt's README as its consumers |
| **Zed** | GPUI | Apache-2.0 (gpui) + GPL (`LICENSE-GPL`) | v1.24.2 2026-10-14 | Yes (editor); framework investment slowed | The only production GPUI app |

Patterns worth recording (factual, not recommendations):
- Every shipped "Stremio-class" desktop app in this table that puts its own UI over the video is **Qt/QML** (Jellyfin Desktop, Haruna, PlasmaTube), **Flutter** (via the texture registry), or **Compose MP with a custom Skiko texture bridge** (mediamp/cove). The ones that use a webview shell keep the video in a **separate window** (ventic) or use per-platform child-window tricks (harbor).
- Android TV is served today by Flutter (Fladder), Compose (`androidx.tv`, cove) and native Android; **no Qt, egui, Slint, Iced, Avalonia or GPUI Android TV app was found.**
- **No Slint, Iced, Avalonia or GPUI media/HTPC app was found at all.** Their credible precedents are elsewhere (Slint: industrial HMIs; Iced: COSMIC; Avalonia: developer tooling; GPUI: Zed).

---

## 13. Could not verify / weak sources

1. **No first-party fps benchmark for any toolkit on the exact workload in question** (4K poster wall + hero art + full-screen focus navigation + in-player overlay). Everything below is either a budget statement, a vendor claim, or a third-party benchmark on a different workload.
2. **Flutter desktop fps on a specific GPU** — I found no official numbers. The 16 ms/8 ms budgets are documentation, and Impeller's benefit is described qualitatively (no shader-compile jank, SDF text). The "120 fps on 120 Hz devices" sentence is a general statement.
3. **Elanis `web-to-desktop-framework-comparison` Linux columns for Tauri.** The 30 s start-duration figure contradicts both the project and public commentary; the Flutter Linux cells are blank/WIP. I used the table only for magnitudes on Windows/macOS and flagged the anomaly.
4. **Avalonia's rendering default contradicts itself across two official pages** (§8.1). I did not resolve it; I quoted both. I also did not verify a flagship production Avalonia app.
5. **Avalonia Media Player** and **Avalonia WebView** are partly commercial/paid offerings; I did not verify their pricing, licensing of the shipped binary, or performance.
6. **Slint image decoding/caching story**: nothing found in the docs; I did not read Slint's source for an internal image cache. Likewise, no Slint gamepad support found, and **no Slint media app**.
7. **GPUI list virtualisation**: the public `gpui` crate docs and `gpui.rs` do not document a virtualised list API; I did not read Zed's source to confirm whether an internal one (e.g. a uniform-height list used by the editor) exists.
8. **Iced**: I did not find first-party numbers for startup/memory/size, and the platform list ("Windows, macOS, Linux, and the Web") comes from the README, not a support-tier page. I did not verify whether any mobile work exists on main.
9. **Compose Multiplatform desktop performance**: (a) the ~240 fps at 4K figure is the `mediamp` project's own commit-message claim, not a reproducible published benchmark; (b) the Compose MP README/mediamp README still says the desktop backend is VLC while a landed commit says the mpv backend is "production-ready" — the two documents disagree, and I did not build either; (c) the `compose.interop.blending` flag's exact current default differs between releases ("now enabled by default" appears in one release's notes) and I did not pin it to a version.
10. **Qt**: I did not extract numbers from `qmlbench` or the Qt 6.6/6.7 QML benchmark blog, so I cannot state a Qt fps figure. I did not verify Qt's on-screen-keyboard story for Android TV. `MpvQt`'s per-file license mapping (LICENSES dir contains LGPL-2.1-only, LGPL-3.0-only, MIT, BSD-3-Clause, CC0) was not read file-by-file.
11. **Stremio shell-ng license**: the GitHub API reports `null`; I did not read the repo for a LICENSE file.
12. **jellyfin-mpv-shim license**: the GitHub API reports no SPDX; I did not read its LICENSE.
13. **`ventic`, `cove`, `Fladder` and the size tables** are release-asset byte sizes from GitHub for the latest release only; they include bundled runtimes (libmpv, mpv, Qt, Skia, adb-installable ABIs) and are not comparable as "code size".
14. **Tauri's `<video>` hardware decoding on Linux** — issue #14424 and the referenced "attempt to force WebKitGTK hardware-accelerated video compositing" commit show the *intent*; I did not verify on a machine whether the shipped WebKitGTK path composite video on the GPU.
15. **`[inference]` labels** in §1 (matrix cells marked ◐), §2.2, §3.2, §3.4, §4.4, §5.2, §5.4, §5.5, §6.2, §6.3, §6.5, §7.3, §8.1, §8.2, §8.3, §8.5, §9.2, §9.5, §11 and §13 flag conclusions I drew rather than read verbatim.
16. **Date skew** as noted in the companion doc: several sources in this environment carry future dates (Qt 6.12 LTS "2026-09-30", Flutter 3.47 "2026-08-12", egui 0.37.0 "2026-10-15"). I report them exactly as the sources state them.
