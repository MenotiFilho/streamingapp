# How the mouse cursor can be hidden over the Picture

**Ticket:** #284 (wayfinder map #283, blocking #285). **Research date:** 2026-11-16.
**Scope:** factual and mechanical findings from the repository and primary upstream sources. **This note names every workable mechanism and what each costs; it does not choose the behaviour or policy** (that belongs to #285).

**Pinned versions verified:** `tauri 2.12.4`, `tao 0.37.1`, `wry 0.57.0`, `libmpv2 6.0.0`, `windows 0.62.2` ([`Cargo.lock`](../../Cargo.lock)); upstream `mpv v0.41.0`; `WebKit` (`main`) and `Chromium` (`main`) as of 2026-11-16.

---

## Summary of answers

| Question (#284) | Verified answer |
|---|---|
| **Which surface owns the cursor over the playing Picture on Windows?** | **Always the WebView2 surface**, never mpv's child window — whether the OSD is visible or hidden. WebView2 sits at `HWND_TOP` with Windowed hosting (`DefaultBackgroundColor` alpha `0` is visually transparent, not click-through), and mpv's child window is `EnableWindow(..., 0)`, `HWND_BOTTOM`, `WS_EX_TRANSPARENT`, and `WM_NCHITTEST -> HTTRANSPARENT`. Only native window borders/titlebar (`decorations: true`) remain owned by `tao`'s parent HWND. |
| **Do mpv's `cursor-autohide`, `cursor-autohide-fs-only`, or `input-cursor` act on the Windows `wid` embed?** | **No.** All three are dead letters on Windows `Placement::InWindow`. `mpv` never receives `WM_MOUSEMOVE` or `WM_SETCURSOR` (`w32->tracking` and `w32->can_set_cursor` stay false), and `SetCursor` on an un-hit-tested child cannot override WebView2. They *do* act when the Picture is `Placement::OwnWindow` (current Linux/macOS build and planned Wayland fallback). |
| **Do Tauri 2 `set_cursor_visible` / `set_cursor_icon` or CSS `cursor: none` work in WebView2?** | **`Window::set_cursor_visible(false)` and `set_cursor_icon` do not work** over WebView2 in `tauri 2.12.4` / `tao 0.37.1` (`tauri#10231`; `tao#1249` is unmerged). **CSS `cursor: none` works** in Windowed WebView2, **including over transparent regions**, provided hit-testing lands on an element with `cursor: none` (subject to specificity overrides and Chromium's stationary-cursor caveats). |
| **Does the same means work on Linux (`OwnWindow`, X11 overlay, Wayland fallback)?** | **Depends on which Picture placement Linux uses:** (1) Current `OwnWindow` and the planned Wayland fallback: **no** — mpv owns the Picture's separate window (`wayland_common.c` / `x11_common.c` `cursor-autohide` hides it; Host CSS/Tauri only touch the Host's GTK window). (2) Transparent WebKitGTK above video (`gtk::Overlay`): **yes** for CSS `cursor: none` (`WebKitWebViewBase`); `tao`'s `set_cursor_visible(false)` on `GtkWindow` is overridden by WebKitGTK's child `GdkWindow`. (3) X11 `wid` + XShape cutouts (#19): **no** for WebKitGTK CSS inside the cutout hole; mpv owns the hole, **and** `mpv` gates `XDefineCursor` on `x11->has_focus`, so hiding via `mpv` fails unless focus leaves the GTK window or the parent X11 window sets the blank cursor. |

---

## 1. Surface ownership over the Picture on Windows

### 1.1 The Win32 HWND stack in `src-tauri/` and `wry`

1. **Host window transparency (`src-tauri/tauri.conf.json`, `src-tauri/tauri.windows.conf.json`)**: The `"main"` window sets `"transparent": true`.
2. **WebView2 container (`wry 0.57.0` `src/webview2/mod.rs:121-288`)**:
   - `InnerWebView::create_container_hwnd` (`src/webview2/mod.rs:191-290`) registers and creates a `WS_CHILD | WS_CLIPCHILDREN | WS_VISIBLE` container child HWND (`WRY_WEBVIEW`) parented to the `tao` window, sized to `Self::parent_bounds(parent)` (`256-258`), and explicitly placed at `HWND_TOP` (`278-286`).
   - `InnerWebView::new` (`131-148`) converts `attributes.transparent` into `background_color = Some((0, 0, 0, 0))` and instantiates **Windowed hosting** via `CreateCoreWebView2Controller` (not `CreateCoreWebView2CompositionController`).
   - Per Microsoft Learn (*Windowed vs. Visual hosting of WebView2* and `ICoreWebView2Controller2::DefaultBackgroundColor`), Windowed hosting gives WebView2 its own Chromium child HWNDs (`Chrome_WidgetWin_0` -> `Chrome_RenderWidgetHostHWND` / `LegacyRenderWidgetHostHWND`) that receive OS mouse messages directly; setting `DefaultBackgroundColor` alpha to `0` makes unpainted pixels see-through to underlying siblings, **not** hit-test-transparent (`HTTRANSPARENT`).
3. **The Player's child HWND (`src-tauri/src/player.rs:36-57`, `src-tauri/src/player/windows.rs:45-147`, `crates/host-mpv/src/lib.rs:1006-1010`)**:
   - `player::placement` hands `window.hwnd()` to `MpvPlayer` as `Placement::InWindow { handle }` (`wid`).
   - `mpv` (`video/out/w32_common.c:2035-2040, 2112-2113`) creates a `WS_CHILD | WS_VISIBLE` window of class `mpv` under `w32->parent` and unconditionally calls `EnableWindow(w32->window, 0)` whenever `w32->parent` is set.
   - `windows::adopt` polls `EnumChildWindows` every 250 ms (`src-tauri/src/player/windows.rs:31, 45-64`) and `windows::place` (`103-134`):
     - forces mpv's child HWND to `HWND_BOTTOM` sized to the client area (`SetWindowPos(..., HWND_BOTTOM, 0, 0, width, height, SWP_NOACTIVATE | SWP_SHOWWINDOW)`);
     - sets `WS_EX_TRANSPARENT` in `GWL_EXSTYLE`;
     - installs `SetWindowSubclass` (`hit_test`, lines `137-147`) returning `HTTRANSPARENT` for every `WM_NCHITTEST`.
   - `docs/research/spike-windows-embedding.md` verified this empirically on Windows 11: synthetic and real clicks in the centre of the playing Picture landed on the webview (`WEBVIEW GOT CLICK: video-area`).

### 1.2 The DOM layer over the Picture (OSD visible vs. OSD hidden)

Whether the OSD is visible or hidden does **not** change HWND ownership:

- **`src/window/Shell.tsx:163-171` and `src/window/repertory/repertory.css:76-89`**: When `pictureBehind` is active, `html.picture-behind` / `body.picture-behind` make `.repertory-ui`, `.shell-frame`, `.rep-frame`, `.shell-base`, and `.shell-nav-slot` visually `background: transparent` so mpv's `HWND_BOTTOM` child shows through.
- **`src/window/PlayerOverlay.tsx:458-485` and `src/window/repertory/osd.css:15-44`**:
  - `.shell-player` is `position: fixed; inset: 0; pointer-events: none`.
  - `.shell-player-picture` (`position: absolute; inset: 0; z-index: 0; pointer-events: auto`) **remains mounted and full-bleed regardless of `useOsdVisibility`'s `visible` state**.
  - When `canTransport` is true (`playing` or `paused`), `<button className="shell-picture-toggle">` fills `inset: 0; width: 100%; height: 100%; background: transparent; cursor: pointer`.
  - When `canTransport` is false (`opening` or `ended`), `.shell-player-picture` itself still has `pointer-events: auto` over the whole Picture.
- **`src/window/useOsdVisibility.ts:55-96`**: `visible` only controls whether the `.shell-osd` chrome above `z-index: 0` is rendered/visible; `keydown`, `pointerdown`, `pointermove`, and `wheel` listeners remain on `document`/`window` inside the WebView2 document.

**Result:** Over the entire client area of the Host window — including transparent pixels over the playing Picture, whether the OSD is up or hidden — **WebView2's `LegacyRenderWidgetHostHWND` receives every `WM_NCHITTEST`, `WM_MOUSEMOVE`, and `WM_SETCURSOR`**. The only parts of the Host window not covered by WebView2 are native non-client chrome (titlebar and resize borders when `decorations: true` and not fullscreen), which belong to `tao`'s parent HWND.

---

## 2. What mpv 0.41 offers when embedded with `wid`

### 2.1 Options and core logic in mpv `v0.41.0`

- **`--cursor-autohide=<number|no|always>`** (`options/options.c:743-744, 951`; `DOCS/man/options.rst:3652-3655`): default `1000` (ms), `"no"` (`-1`), `"always"` (`-2`).
- **`--cursor-autohide-fs-only`** (`options/options.c:745`; `DOCS/man/options.rst:3657-3660`): default `no`. When enabled, forces cursor visibility to `true` whenever `!opts->vo->fullscreen` (`player/playloop.c:846-847`).
- **`--input-cursor`** (`options/options.c:190, 213`; `DOCS/man/input.rst`): default `yes` (`OPT_BOOL(enable_mouse_movements)`). In `input/input.c:947-953`, `mp_input_set_mouse_pos` only updates `ictx` mouse coordinates (which bumps `mp_input_get_mouse_event_counter` used by `handle_cursor_autohide`) when `enable_mouse_movements` is true.
- **Autohide loop (`player/playloop.c:816-852`, `handle_cursor_autohide`)**: compares `mp_input_get_mouse_event_counter(mpctx->input)` against `mpctx->mouse_event_ts`; on change, arms `mpctx->mouse_timer = now + cursor_autohide_delay / 1000.0`; on expiry (subject to `-1`/`-2`/fullscreen checks), dispatches `vo_control(vo, VOCTRL_SET_CURSOR_VISIBILITY, &mouse_cursor_visible)` to the active video output.
- **Current Host configuration (`crates/host-mpv/src/lib.rs:962-1018`)**: `options()` sets `osc=no` and `input-default-bindings=no`, and **does not set** `cursor-autohide`, `cursor-autohide-fs-only`, or `input-cursor`, leaving mpv's defaults (`cursor-autohide=1000`, `cursor-autohide-fs-only=no`, `input-cursor=yes`) active.

### 2.2 Why none of the three options act on Windows `wid`

In `video/out/w32_common.c` (`v0.41.0`):

- **`WM_SETCURSOR` (`1598-1606`)**: sets `w32->can_set_cursor = LOWORD(lParam) == HTCLIENT && HIWORD(lParam)` and calls `SetCursor(NULL)` if `w32->can_set_cursor && !w32->cursor_visible`.
- **`WM_MOUSEMOVE` / `WM_MOUSELEAVE` (`1607-1614, 2105`)**: `w32->tracking` starts `FALSE` and becomes `TRUE` only when `WM_MOUSEMOVE` reaches `w32->window` and calls `TrackMouseEvent`.
- **`VOCTRL_SET_CURSOR_VISIBILITY` (`2359-2368`)**: checks `if (w32->can_set_cursor && w32->tracking)` before calling `SetCursor(NULL)` / `SetCursor(LoadCursor(NULL, IDC_ARROW))`.
- **`EnableWindow(w32->window, 0)` (`2112-2113`)**: mpv explicitly disables its own child HWND whenever `w32->parent` (`wid`) is set.

Because mpv's child HWND is disabled (`WS_DISABLED`), at `HWND_BOTTOM`, tagged `WS_EX_TRANSPARENT`, answers `HTTRANSPARENT`, and lies beneath full-bleed `WRY_WEBVIEW`:

1. `w32->window` never receives `WM_MOUSEMOVE` or `WM_SETCURSOR`; `w32->tracking` stays `FALSE` and `w32->can_set_cursor` stays `false`.
2. Even if `SetCursor(NULL)` were called unconditionally on `w32->window`'s thread, Microsoft Learn (`SetCursor`, `WM_SETCURSOR`) specifies that the cursor shape on screen is determined by the window under the pointer receiving `WM_SETCURSOR` — here WebView2's HWND, not mpv's.
3. `input-cursor=no` only stops `mp_input_set_mouse_pos` from forwarding pointer moves to mpv's input/OSC layer (`input/input.c:947-953`); on Windows `wid` mpv already receives zero pointer events, so `input-cursor=no` is harmless hygiene rather than a cursor-hiding mechanism.

*(Note: when `Placement::OwnWindow` is used instead of `wid`, mpv's default `cursor-autohide=1000` already hides the cursor over the Picture after 1 s of pointer inactivity.)*

---

## 3. What Tauri 2 and CSS `cursor: none` do on Windows WebView2

### 3.1 Tauri 2 `Window::set_cursor_visible` and `Window::set_cursor_icon`

- **API & capabilities**: Rust `WebviewWindow::set_cursor_visible(bool)` / `set_cursor_icon(CursorIcon)` (`tauri 2.12.4` `crates/tauri/src/window/mod.rs`) bypass frontend ACLs; JS `getCurrentWindow().setCursorVisible(...)` / `setCursorIcon(...)` (`@tauri-apps/api/window`) require `core:window:allow-set-cursor-visible` and `core:window:allow-set-cursor-icon` (`tauri` autogenerated window permissions reference), neither of which is in `src-tauri/capabilities/default.json` today.
- **Why both fail over WebView2 in `tao 0.37.1` (`Cargo.lock`)**:
  1. **`set_cursor_visible(false)` calls `ShowCursor(TRUE)` instead of `ShowCursor(FALSE)`**: `Window::set_cursor_visible` (`tao/src/platform_impl/windows/window.rs`) flips `CursorFlags::HIDDEN` and invokes `CursorFlags::refresh_os_cursor` (`tao/src/platform_impl/windows/window_state.rs:486-517`):
     ```rust
     let cursor_in_client = self.contains(CursorFlags::IN_WINDOW);
     if cursor_in_client {
       util::set_cursor_hidden(self.contains(CursorFlags::HIDDEN));
     } else {
       util::set_cursor_hidden(false);
     }
     ```
     `CursorFlags::IN_WINDOW` is set **only** in `tao`'s `WM_MOUSEMOVE` handler and cleared in `WM_MOUSELEAVE` (`tao/src/platform_impl/windows/event_loop.rs:1236-1301`) on `tao`'s **parent** HWND. Because `WRY_WEBVIEW` (`HWND_TOP`) + WebView2 covers the entire client area, `tao`'s parent HWND receives no `WM_MOUSEMOVE` over the client area, `IN_WINDOW` stays `false`, and `util::set_cursor_hidden(false)` calls `ShowCursor(TRUE)` (`tao/src/platform_impl/windows/util.rs:165-171`).
  2. **Chromium owns `WM_SETCURSOR` in `msedgewebview2.exe`**: WebView2's `LegacyRenderWidgetHostHWND::OnSetCursor` (`content/browser/renderer_host/legacy_render_widget_host_win.cc:753-757`) returns `0` (marked handled in WTL, not forwarded to `DefWindowProc` / parent), and Chromium's `HWNDMessageHandler::OnSetCursor` (`ui/views/win/hwnd_message_handler.cc:3054-3056`) calls `SetCursor(current_cursor_)` on `HTCLIENT` and returns `1`. Therefore `tao`'s `WM_SETCURSOR` handler (`event_loop.rs:1771-1794`) does not run for points inside WebView2, so `Window::set_cursor_icon(...)` is ignored/overwritten as well.
  3. **Upstream status**: `tauri-apps/tauri#10231` remains **open**. `tauri-apps/tao#1249` (replacing `IN_WINDOW` with `GetCursorPos` + `ScreenToClient` in `window_state.rs` and calling `SetCursor(None)` when `is_hidden && in_client_area`) is **open and unmerged**, so it is not present in `tao 0.37.1`.

### 3.2 CSS `cursor: none` in WebView2 (and over transparent regions)

- **Windowed vs. Visual hosting**: `MicrosoftEdge/WebView2Feedback#2766` (where several CSS cursor values fail) affects XAML / MAUI **Visual hosting** (`CoreWebView2CompositionController`), where XAML maps cursor enums. Tauri / `wry` uses **Windowed hosting** (`CreateCoreWebView2Controller`, `wry/src/webview2/mod.rs:142-148`), where Chromium itself translates CSS cursors directly to Win32 `HCURSOR`s.
- **Why it works over transparent regions**: Because Windowed WebView2 handles hit-testing across its whole HWND bounds regardless of `DefaultBackgroundColor = (0, 0, 0, 0)`, CSS `cursor: none` applies over transparent pixels as long as the pointer hit-tests onto a DOM element (such as `.shell-player-picture`, `.shell-picture-toggle`, or an ancestor `body` behind `pointer-events: none` nodes) whose computed `cursor` is `none`.
- **Chromium execution path**:
  1. On mouse move or CSS cursor change, Blink's `EventHandler::CursorUpdateTimerFired` -> `EventHandler::UpdateCursor()` (`third_party/blink/renderer/core/input/event_handler.cc:501-539`) runs a read-only hit-test at `LastKnownMousePositionInViewport()` and calls `SelectCursor(...)` -> `view->SetCursor(...)`.
  2. Browser-side `RenderWidgetHostViewAura::UpdateCursor` -> `DisplayCursor` -> `UpdateCursorIfOverSelf()` (`content/browser/renderer_host/render_widget_host_view_aura.cc:1104-1120, 3300-3331`) checks `ShouldSkipCursorUpdate()` and `IsPointerOverSelfOrUnboundedSurface()`, explicitly keeps `CursorType::kNone` even while `is_loading_` is true (`line 3320: if (is_loading_ && cursor != ui::mojom::CursorType::kNone)`), and forwards to `aura::client::CursorClient::SetCursor` -> `HWNDMessageHandler::SetCursor` -> Win32 `::SetCursor(NULL)`.
- **Costs and documented Chromium/WebView2 caveats**:
  - **Element-level overrides in this repo**: Explicit `cursor: pointer` / `cursor: default` rules take precedence over ancestor rules on the hovered target — in particular `.shell-picture-toggle` (`src/window/repertory/osd.css:43`), `.shell-osd-icon` (`osd.css:382`), `.shell-osd-scrubber` (`osd.css:469`), `.shell-osd-chapter` (`osd.css:630`), and `.rep-osd-fader-input` (`osd.css:664`). If the pointer rests over any mounted element with an explicit `cursor` rule, ancestor `cursor: none` will not hide it unless overridden on that element too.
  - **Stationary-cursor / unfocused edge cases**: Chromium issues `#41031275` and `#41314693` document cases on Windows where toggling CSS `cursor: none` while the pointer is completely stationary (especially if the window lacks focus, DevTools is open, or GPU/OS sync stalls) fails to refresh the OS cursor immediately until a physical mouse movement or a layout/hit-test change (e.g., toggling a cover element) occurs; synthetic JS `MouseEvent('mousemove')` does not move `LastKnownMousePositionInViewport()` or re-trigger native `WM_SETCURSOR`.
  - **Client-area boundary**: WebView2 only covers the client rect; if the pointer rests on native non-client window borders/titlebar (in windowed mode), CSS `cursor: none` does not touch it.

---

## 4. Linux build (`OwnWindow`, X11 overlay / `wid`, Wayland fallback)

`src-tauri/src/player.rs:58-63` currently sets `Placement::OwnWindow` on `#[cfg(not(windows))]`. Because Linux has three distinct architectural shapes (current `OwnWindow`, planned Wayland fallback per ADR-0003 / ADR-0007, and the open X11 `wid` investigation in #19), cursor behaviour differs across them:

| Linux configuration | Which surface owns the cursor over the Picture | Does CSS `cursor: none` work? | Does Tauri `set_cursor_visible(false)` work? | Does mpv `cursor-autohide` work? |
|---|---|---|---|---|
| **Current Linux build (`Placement::OwnWindow`) & Wayland fallback (ADR-0003, ADR-0007)** | **mpv's own top-level window** (`Picture::OwnWindow`), separate from the Host's GTK window. | **No** — WebKitGTK is in a separate window. | **No** — only acts on the Host's GTK window. | **Yes** (`wayland_common.c:304, 3639-3670` calls `wl_pointer_set_cursor(..., NULL, 0, 0)`; `x11_common.c:190-222` calls `XDefineCursor` with an 8×8 blank `Pixmap` when focused). |
| **Transparent WebKitGTK composited above video (`gtk::Overlay` + `GLArea`, e.g. Harbor `menoti/slim`)** | **WebKitGTK (`WebKitWebViewBase`)**, covering the window above the `GLArea`. | **Yes** — `WebKitWebViewBase.cpp:3763-3764, 3816-3817` maps `Cursor::Type::None` to `"none"` -> `gdk_cursor_new_from_name(display, "none")` on `WebKitWebView`'s `GdkWindow`. | **Unreliable / overridden** — `tao` (`linux/window.rs:819-833`, `linux/event_loop.rs:432-443`) sets `CursorType::BlankCursor` on the parent `GtkWindow`'s `GdkWindow`, which is overridden by `WebKitWebView`'s own child `GdkWindow` whenever WebKit sets a non-null cursor (`pointer`, `default` after `pointer`, `WebKitWebViewBase.cpp:3803-3818`). | **No** — `vo=libmpv` renders textures, not a VO window. |
| **X11 `wid` embed + XShape cutouts (Ventic pattern, #19)** | **mpv's X11 child window (`x11->window`)** exposed directly through the cutout hole (`x11_common.c:1544`). | **No** inside the Picture hole (WebKitGTK's bounding/input shape is subtracted out of that region). | **Partially, via X11 cursor inheritance** — `tao` calls `gdk_window.set_cursor(BlankCursor)` on the parent `GtkWindow`. While `x11->window` has cursor `0` (`None`, `x11_common.c:221`), X11 child windows inherit their parent's cursor; however, if `WebKitWebView` sits beside it, only the `GtkWindow` -> `x11->window` path inherits, and `tao`'s `X11` drag-edge listener (`linux/event_loop.rs:516-521`) can reset `window.set_cursor("default")`. | **Only if mpv's child window has X11 focus** (`x11_common.c:199`: `should_hide = x11->has_focus && !x11->mouse_cursor_visible`). If focus stays on the parent GTK window so keyboard shortcuts reach WebKitGTK, `x11->has_focus` stays `false` and `vo_update_cursor` refuses to hide the cursor. |

---

## 5. Every workable mechanism and what each costs

### A. Workable mechanisms

1. **CSS `cursor: none` in the WebView DOM (Windows WebView2 + Linux `gtk::Overlay`/WebKitGTK)**
   - *How it acts:* Toggling a CSS class/attribute on the player layer (or document root while over the Picture) sets `cursor: none` across WebView2 (`HWNDMessageHandler::SetCursor(::SetCursor(NULL))`) and WebKitGTK (`gdk_window_set_cursor(..., "none")`), including transparent regions.
   - *Costs:*
     - Must account for every hit-tested child rule with an explicit `cursor` (`src/window/repertory/osd.css:43, 382, 469, 630, 664`) whenever cursor hiding is active, otherwise hovering `.shell-picture-toggle` or any visible control keeps `cursor: pointer`.
     - Subject to Chromium's stationary-pointer / unfocused / DevTools edge cases (`#41031275`, `#41314693`) where changing CSS `cursor` without mouse movement may lag or require a layout/hit-test change; untestable reliably under automated no-move unless checked on real Windows WebView2.
     - Does not cover native non-client window borders/titlebar (`decorations: true`), nor does it cover `Placement::OwnWindow` or an X11 XShape cutout hole on Linux.

2. **Win32 input-passthrough cutout exposing mpv's child HWND or `tao`'s parent HWND (Windows-only)**
   - *How it acts:* Instead of WebView2 owning pointer hit-testing over the hidden-UI Picture, cut the Picture out of `WRY_WEBVIEW` (`SetWindowRgn`) or flip `WRY_WEBVIEW` hit-testing (`WS_EX_TRANSPARENT` / `WM_NCHITTEST -> HTTRANSPARENT`) when hiding:
     - *Variant 2a (route to `tao` parent HWND):* Keep mpv's child disabled (`EnableWindow(..., 0)`), let `tao`'s HWND receive `WM_MOUSEMOVE` + `WM_SETCURSOR` (making `tao`'s `IN_WINDOW` and `set_cursor_icon` / `WM_SETCURSOR` `SetCursor(NULL)` work — provided `tao#1249` or a Host subclass handles `WM_SETCURSOR` with `SetCursor(None)` when hidden).
     - *Variant 2b (route to mpv's child HWND):* Also call `EnableWindow(mpv_hwnd, TRUE)` and drop `WS_EX_TRANSPARENT` / `HTTRANSPARENT` from `src-tauri/src/player/windows.rs`, letting mpv's own `w32_common.c` `cursor-autohide` / `VOCTRL_SET_CURSOR_VISIBILITY` run.
   - *Costs:*
     - WebView DOM stops receiving native `pointermove` / `pointerdown` / `wheel` / click events while bypassed: `.shell-picture-toggle` click-to-play/pause (`PlayerOverlay.tsx:477-485`) and `useOsdVisibility.ts` pointer-move/wheel wake stop working unless the Host observes Win32 messages via a subclass (`2a`) or mpv input (`2b`) and bridges them back to the frontend, plus toggles passthrough off whenever the OSD reappears.
     - `SetWindowRgn` clips WebView2's alpha-blended translucent OSD scrims and fades (`docs/research/spike-windows-embedding.md` and ADR-0003 rejected region shaping in favour of transparent WebView2 above `HWND_BOTTOM` mpv).
     - Variant 2b also steals clicks/wheel/keyboard focus from WebView2 and reverses `w32_common.c:2113` (`EnableWindow(w32->window, 0)`).

3. **WebView2 Visual hosting via `ICoreWebView2CompositionController` (Windows-only)**
   - *How it acts:* Replace `wry`'s Windowed `CreateCoreWebView2Controller` (`wry/src/webview2/mod.rs:142`) with `CreateCoreWebView2CompositionController`; the Host owns all `WM_MOUSEMOVE` and `WM_SETCURSOR` directly on its HWND, forwards mouse events via `SendMouseInput`, and calls `SetCursor(NULL)` directly in `WM_SETCURSOR`.
   - *Costs:*
     - Requires forking or bypassing `wry`'s Windows WebView2 backend, building and maintaining a DirectComposition visual tree, manually forwarding pointer/wheel/drag-and-drop/IME input, and losing native Windowed cursor support (`WebView2Feedback#2766`, `#3388`).

4. **HTML5 Pointer Lock API (`element.requestPointerLock()`) (Windows WebView2 + Linux WebKitGTK)**
   - *How it acts:* Locks the pointer to an element in the WebView and hides the OS cursor unconditionally while locked; `document.exitPointerLock()` restores it.
   - *Costs:*
     - Browser security rules require an active user gesture — **cannot** be triggered by an idle timer (`useOsdVisibility` / autohide timeout).
     - Traps/suppresses normal pointer coordinates, preventing simple cursor movement from revealing where the pointer is on the scrubber or waking the cursor without breaking lock; hijacks `Escape` and may display browser lock hints.

5. **Native Player / X11-parent cursor control for `OwnWindow` and X11 `wid` (non-WebView-covered Picture)**
   - *How it acts:*
     - In **`Placement::OwnWindow`** (current Linux/macOS build and planned Wayland fallback): configure mpv's own `cursor-autohide` / `cursor-autohide-fs-only` / `input-cursor` (already defaulting to `1000` ms in `crates/host-mpv/src/lib.rs`).
     - In **X11 `wid` + XShape cutouts** (#19, if adopted): call `XDefineCursor` with a blank cursor on the parent X11 window (so `x11->window` inherits it while `x11->mouse_cursor_visible` keeps cursor `0`) *or* transfer X11 focus to `x11->window` so mpv's `vo_update_cursor` (`x11_common.c:199`) can hide it.
   - *Costs:*
     - Does not apply to Windows `InWindow` at all.
     - In X11 `wid`, setting a blank cursor on the parent X11 window affects non-WebKitGTK descendant regions unless scoped, while giving focus to `x11->window` diverts keyboard events away from WebKitGTK.

### B. Mechanisms that do NOT work in the current stack (and why)

- **mpv `cursor-autohide`, `cursor-autohide-fs-only`, `input-cursor` on Windows `InWindow` (`wid`)**: mpv's child HWND is disabled, bottom-most, and click-through beneath `WRY_WEBVIEW` (`w32_common.c:1598-1613, 2113, 2359-2367`).
- **Tauri 2 `Window::set_cursor_visible(false)` / `set_cursor_icon` (`tauri 2.12.4` / `tao 0.37.1`)**:
  - On **Windows**: `CursorFlags::IN_WINDOW` stays `false` because WebView2 eats `WM_MOUSEMOVE` (`window_state.rs:512-516`, `event_loop.rs:1236-1301`), causing `tao` to call `ShowCursor(TRUE)`, and `LegacyRenderWidgetHostHWND::OnSetCursor` absorbs `WM_SETCURSOR` in `msedgewebview2.exe` (`tauri#10231`, unmerged `tao#1249`).
  - On **Linux WebKitGTK**: `tao` sets `BlankCursor` on the parent `GtkWindow`, which `WebKitWebViewBase`'s child `GdkWindow` overrides whenever any DOM cursor is active (`WebKitWebViewBase.cpp:3803-3818`).
- **Win32 `SetWindowSubclass` on `WRY_WEBVIEW` or `tao`'s HWND**: `LegacyRenderWidgetHostHWND::OnSetCursor` returns `0` without calling `DefWindowProc` (`legacy_render_widget_host_win.cc:753-757`), so `WM_SETCURSOR` never bubbles to `WRY_WEBVIEW` or `tao`; and Win32 forbids `SetWindowSubclass` across processes onto `msedgewebview2.exe`'s `Chrome_RenderWidgetHostHWND`.

---

## Primary sources cited

- **Repository:** [`src-tauri/src/player.rs`](../../src-tauri/src/player.rs), [`src-tauri/src/player/windows.rs`](../../src-tauri/src/player/windows.rs), [`crates/host-mpv/src/lib.rs`](../../crates/host-mpv/src/lib.rs), [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json), [`src-tauri/tauri.windows.conf.json`](../../src-tauri/tauri.windows.conf.json), [`src-tauri/capabilities/default.json`](../../src-tauri/capabilities/default.json), [`src/window/Shell.tsx`](../../src/window/Shell.tsx), [`src/window/PlayerOverlay.tsx`](../../src/window/PlayerOverlay.tsx), [`src/window/useOsdVisibility.ts`](../../src/window/useOsdVisibility.ts), [`src/window/repertory/repertory.css`](../../src/window/repertory/repertory.css), [`src/window/repertory/osd.css`](../../src/window/repertory/osd.css), [`docs/research/spike-windows-embedding.md`](spike-windows-embedding.md), [`docs/research/libmpv-embedding-facts.md`](libmpv-embedding-facts.md).
- **mpv `v0.41.0` (`mpv-player/mpv`):** `DOCS/man/options.rst`, `options/options.c`, `input/input.c`, `player/playloop.c`, `video/out/w32_common.c`, `video/out/x11_common.c`, `video/out/wayland_common.c`.
- **Tauri / Tao / Wry:** `tauri-apps/tauri@tauri-v2.12.4` (`crates/tauri/src/window/mod.rs`, `packages/api/src/window.ts`, window permissions reference), `tauri-apps/tao@tao-v0.37.1` (`src/platform_impl/windows/{window.rs,window_state.rs,event_loop.rs,util.rs}`, `src/platform_impl/linux/{window.rs,event_loop.rs}`), `tauri-apps/wry@wry-v0.57.0` (`src/webview2/mod.rs`, `src/webkitgtk/mod.rs`), `tauri-apps/tauri#10231`, `tauri-apps/tao#1249`.
- **WebView2 / Chromium / WebKitGTK / Win32:** Microsoft Learn (`ShowCursor`, `SetCursor`, `WM_SETCURSOR`, *Windowed vs. Visual hosting of WebView2*, `ICoreWebView2Controller2::DefaultBackgroundColor`), `MicrosoftEdge/WebView2Feedback#2766`, `#3388`, `#5771`, Chromium (`content/browser/renderer_host/legacy_render_widget_host_win.cc`, `content/browser/renderer_host/render_widget_host_view_aura.cc`, `ui/views/win/hwnd_message_handler.cc`, `third_party/blink/renderer/core/input/event_handler.cc`, Chromium issues `#41031275` & `#41314693`), WebKit (`Source/WebKit/UIProcess/API/gtk/WebKitWebViewBase.cpp`).
