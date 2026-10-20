# Gamepad and TV-remote input in the webview and the browser — fact-finding

**Date of research:** 2026-10-16. Every spec / MDN / vendor / bug-tracker read was done on this date.
**Scope:** verifiable facts only, with source links. Inferences are labelled `[inference]`; anything I could not confirm is in §7.
**Question (issue #49).** What input can a dpad, gamepad, or TV remote actually deliver to (a) the Tauri window's webview and (b) the companion's browser page, and what is a sensible default mapping?

**Environment note.** As in the sibling documents in this folder, some sources carry dates that sit in the future relative to a naive reading; I report each version and date exactly as the source states it. Current toolchain per `docs/research/gui-toolkit-performance-multiplatform.md` §0: **Tauri 2.12.4** stable (2026-10-14), rendering through **WebView2 (Chromium/Edge) on Windows** and **WebKitGTK on Linux**.

**The one structural fact this document turns on.** A gamepad does **not** produce keyboard events. The W3C Gamepad specification says so in its introduction:

> "Currently, the only way for a gamepad to be used as input would be to emulate mouse or keyboard events, however this would lose information and require additional software outside of the user agent to accomplish emulation."
> — [W3C Gamepad, Working Draft 10 July 2025, §1](https://www.w3.org/TR/gamepad/)

So a gamepad and a TV remote arrive on **two different JavaScript channels**:
* a **TV / IR remote** presents as a normal keyboard, so it arrives as `keydown` / `keyup` events (`KeyboardEvent.key`) — the channel the old shell's `src/useArrowKeys.ts` listened on (removed in #87; `src/shell/useSpatialFocus.ts` is its successor);
* a **gamepad** (Xbox/PS/Bluetooth pad) arrives **only** through the `Gamepad` API, which must be **polled**; it emits no DOM events per button.

---

## 1. What a gamepad delivers: the Gamepad API

### 1.1 The interface

The API is three interfaces, two events and one function ([MDN, Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API)):

* `navigator.getGamepads()` → an array of `Gamepad` objects. "Elements in the array may be `null` if a gamepad disconnects during a session, so that the remaining gamepads retain the same index." ([MDN, `Navigator.getGamepads()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads))
* `window.gamepadconnected` / `window.gamepaddisconnected`.
* Each `Gamepad` has `id`, `index`, `connected`, `timestamp`, `mapping`, `axes`, `buttons` ([W3C §4](https://www.w3.org/TR/gamepad/)).
* Each `GamepadButton` has `pressed` (boolean), `touched` (boolean) and `value` — an analog reading "linearly normalized to the range \[0 .. 1\]", so "1 *MUST* mean fully pressed" ([W3C §5](https://www.w3.org/TR/gamepad/)). Triggers are analog, not just on/off.
* Each axis is a double "linearly normalized to the range \[-1 .. 1\]" ([W3C §4](https://www.w3.org/TR/gamepad/)).

### 1.2 The "standard" mapping (button and axis indices)

Indices are only portable when `gamepad.mapping === "standard"`. MDN: "Currently there is only one supported known layout — the standard gamepad… If the browser is able to map controls on the device to that layout the `mapping` property will be set to the string `standard`." ([MDN, Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)). Anything else is raw, device-specific ordering.

The canonical "Standard Gamepad" layout ([W3C Gamepad §14 Remapping](https://www.w3.org/TR/gamepad/)):

| Type | Index | Location (spec's words) |
|---|---|---|
| Button | 0 | Bottom button in right cluster (Xbox A · PlayStation Cross) |
| Button | 1 | Right button in right cluster (B · Circle) |
| Button | 2 | Left button in right cluster (X · Square) |
| Button | 3 | Top button in right cluster (Y · Triangle) |
| Button | 4 | Top left front button (LB · L1) |
| Button | 5 | Top right front button (RB · R1) |
| Button | 6 | Bottom left front button (LT · L2, analog) |
| Button | 7 | Bottom right front button (RT · R2, analog) |
| Button | 8 | Left button in center cluster (View · Back · Share) |
| Button | 9 | Right button in center cluster (Menu · Start · Options) |
| Button | 10 | Left stick pressed button (L3) |
| Button | 11 | Right stick pressed button (R3) |
| Button | 12 | Top button in left cluster (D-pad up) |
| Button | 13 | Bottom button in left cluster (D-pad down) |
| Button | 14 | Left button in left cluster (D-pad left) |
| Button | 15 | Right button in left cluster (D-pad right) |
| Button | 16 | Center button in center cluster (Guide · Home) |
| axes | 0 | Horizontal axis for left stick (negative left / positive right) |
| axes | 1 | Vertical axis for left stick (negative up / positive down) |
| axes | 2 | Horizontal axis for right stick (negative left / positive right) |
| axes | 3 | Vertical axis for right stick (negative up / positive down) |

The spec deliberately names locations, not letters, and notes the mapping "SHOULD consider the accessible model to have the same input control layout as the standard model" ([W3C §3.1](https://www.w3.org/TR/gamepad/)) — so an adaptive controller is supposed to report the same indices. `[inference]` Any code that switches on Xbox lettering ("A", "B") is wrong for a PlayStation pad; switch on the index.

### 1.3 Connecting, disconnecting, and the user-gesture rule

A page that already had the gamepad connected still only learns of it "when the user presses a button or moves an axis" ([MDN, Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)). The spec is explicit: the gamepad object is not exposed and `gamepadconnected` is not fired until `navigator.[[hasGamepadGesture]]` is set by a **gamepad user gesture**, at which point every already-connected pad's `[[exposed]]` flag is set and the event fires ([W3C §4.1 "Receiving inputs"](https://www.w3.org/TR/gamepad/)).

Firefox tightens this further:

> "In Firefox, gamepads are only exposed to a page when the user interacts with one with the page visible. This helps prevent gamepads from being used for fingerprinting the user."
> — [MDN, Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)

MDN's own advice is to keep connected devices keyed by `index` from the events, and "for current button and axis state, call `Navigator.getGamepads()` each frame and read the latest object for that `index`" — do not hold a long-lived reference from the event.

### 1.4 You must poll, in a `requestAnimationFrame` loop

There are no per-button DOM events. MDN:

> "To read the current button and axis state, use the gamepad's `index` and fetch the latest object from `Navigator.getGamepads()` in your animation loop… Performing such checks tends to involve using the `Gamepad` object in conjunction with an animation loop (e.g., `requestAnimationFrame`)."
> — [MDN, Using the Gamepad API](https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API)

`requestAnimationFrame` has a documented caveat for a hidden window:

> "`requestAnimationFrame()` calls are paused in most browsers when running in background tabs or hidden `<iframe>`s, in order to improve performance and battery life."
> — [MDN, `Window.requestAnimationFrame()`](https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame)

`[inference]` A minimised Host window therefore stops polling; the polling loop should restart on `visibilitychange` and should not assume it ran while hidden.

### 1.5 Restrictions: secure context, Permissions-Policy, and no synthetic input

The Gamepad API is on MDN's list of **features restricted to secure contexts** ([MDN, Features restricted to secure contexts](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts)). Mozilla's own announcement:

> "Starting with Firefox 81, the Gamepad API will be restricted to… 'secure contexts'… This means that Gamepad API will only work on sites served as 'https://'. But don't worry, it also works on http://localhost too… calling `.getGamepads()` will return an empty array."
> — [Mozilla Hacks, "Securing Gamepad API", 2020-07-01](https://hacks.mozilla.org/2020/07/securing-gamepad-api/)

Chromium made the same move; the tracking issue's title is **"Restrict Gamepad API usage (permissions policy & secure context)"** and its summary reads "Gamepad API will stop returning information about connected gamepads when accessed from non-secure contexts" ([Chromium issue 40221455](https://issues.chromium.org/issues/40221455)).

Separately, a `Permissions-Policy: gamepad` directive can block it outright:

> "where a defined policy blocks use of this feature, calls to `Navigator.getGamepads()` will throw a `SecurityError` `DOMException`. In addition, the `gamepadconnected` and `gamepaddisconnected` events will not fire."
> The **default allowlist for `gamepad` is `*`.** — [MDN, `Permissions-Policy: gamepad`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/gamepad)

`[inference]` A top-level page (the window or the companion) is **not** affected by the Permissions-Policy default; a cross-origin `<iframe>` would be. There is no JavaScript API that can synthesise a *trusted* gamepad reading — you can only read what the user agent exposes.

---

## 2. What a dpad / TV remote / IR remote delivers: key events

### 2.1 Arrows, Enter, Escape, Backspace

The `KeyboardEvent.key` values these devices produce are ordinary, stable names ([MDN, Key values for keyboard events](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values)):

| Key value | Meaning (MDN) |
|---|---|
| `"ArrowUp"` / `"ArrowDown"` / `"ArrowLeft"` / `"ArrowRight"` | The four arrow keys (older Edge/Firefox used `"Up"`, `"Down"`, `"Left"`, `"Right"`) |
| `"Enter"` | The Enter/Return key |
| `" "` (Space) | Space Bar (older browsers returned `"Spacebar"`) |
| `"Escape"` | Esc — "typically used as an exit, cancel, or 'escape this operation' button" |
| `"Backspace"` | Backspace (labelled Delete on Mac keyboards) |
| `"ContextMenu"` | The menu key; Android `KEYCODE_MENU` (82) |
| `"Accept"` | "The Accept, Commit, or OK key or button"; Android `KEYCODE_DPAD_CENTER` (23) |

Note from the same table: Android `KEYCODE_DPAD_CENTER` (23) maps to **both** `"Enter"` and `"Accept"` depending on the browser's reading; treat both as "activate".

### 2.2 An Android TV / Google TV remote

An Android remote's raw keycodes reach JavaScript as the `key` values in the same table. The relevant Android keycodes and their `key` values:

| Android keycode | JS `KeyboardEvent.key` |
|---|---|
| `KEYCODE_DPAD_UP` (19) | `"ArrowUp"` |
| `KEYCODE_DPAD_DOWN` (20) | `"ArrowDown"` |
| `KEYCODE_DPAD_LEFT` (21) | `"ArrowLeft"` |
| `KEYCODE_DPAD_RIGHT` (22) | `"ArrowRight"` |
| `KEYCODE_DPAD_CENTER` (23) | `"Enter"` / `"Accept"` |
| `KEYCODE_ESCAPE` (111) | `"Escape"` |
| `KEYCODE_BACK` (4) | `"GoBack"` |
| `KEYCODE_MENU` (82) | `"ContextMenu"` |
| `KEYCODE_MEDIA_PLAY_PAUSE` (85) | `"MediaPlayPause"` |
| `KEYCODE_MEDIA_REWIND` (89) | `"MediaRewind"` |
| `KEYCODE_MEDIA_FAST_FORWARD` (90) | `"MediaFastForward"` |
| `KEYCODE_MEDIA_STOP` (86) | `"MediaStop"` |
| `KEYCODE_MEDIA_NEXT` (87) / `KEYCODE_MEDIA_PREVIOUS` (88) | `"MediaTrackNext"` / `"MediaTrackPrevious"` |

(All from [MDN, Key values → Navigation / UI / Phone / Multimedia keys](https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values).)

### 2.3 An IR remote is a keyboard

On Linux, the kernel's Remote Controller subsystem registers a supported IR receiver as a keyboard in the input layer:

> "The modules register the remote as keyboard within the linux input layer. This means that the IR key strokes will look like normal keyboard key strokes (if `CONFIG_INPUT_KEYBOARD` is enabled)."
> — [Linux kernel, Remote controller tables](https://www.kernel.org/doc/html/v4.9/media/uapi/rc/rc-tables.html)

The same page's default IR keymap sends **`KEY_UP` / `KEY_DOWN` / `KEY_LEFT` / `KEY_RIGHT`** for the arrows, **`KEY_OK`** ("OK / ENTER / RETURN") for confirm, and **`KEY_ESC`** for "CANCEL / BACK" — which are exactly `"ArrowUp"`, `"Enter"`, `"Escape"` at the JS layer. `[inference]` In other words, a plain IR remote is indistinguishable from a keyboard to a webview; the existing `keydown` handler is the right seam for it.

### 2.4 Back: what is and is not interceptable

There are three different "Back" behaviours, and only one is a JS key you can handle:

* **A desktop browser tab (the companion on a laptop).** Back is the browser's own session-history navigation. You cannot cancel it, but `popstate` fires after it: "the `popstate` event will be triggered by doing a browser action such as a click on the back or forward button (or calling `history.back()`)". Crucially, "browsers may not fire the `popstate` event at all unless the page has been interacted with" — so the *first* Back can leave the page with no event ([MDN, `Window: popstate`](https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event)). The common single-page-app "back trap" (push a state, re-push on `popstate`) is a workaround, not a guarantee, and cannot stop a tab close.
* **An Android WebView (Tauri on Android / Android TV).** `BACK` is handled by the host Activity by default, not by the page. Android's own guidance introduces `onBackPressed()` (and the older `onKeyDown(KEYCODE_BACK, …)` pattern) as the way an Activity intercepts Back ([Android Developers Blog, "Back and other hard keys: three stories", 2009-12-18](https://android-developers.googleblog.com/2009/12/back-and-other-hard-keys-three-stories.html)), and `WebView.canGoBack()` / `goBack()` is the host's WebView navigation ([LogRocket, "WebView and Android back button navigation"](https://blog.logrocket.com/customize-androids-back-button-navigation-webview/)). JS sees `"GoBack"` **only if the embedding app forwards the key** to the WebView; `[inference]` Tauri would need Rust/Kotlin glue to do that.
* **A desktop Tauri window (Windows/Linux).** There is no browser chrome and no Back button; "Back" is whatever the app's own `back()` does. Escape is that, today, in the shell's `useSpatialFocus` (the note below describes the old shell's `src/useArrowKeys.ts`, removed in #87).

---

## 3. Platform support matrix

### 3.1 Windows — Tauri 2 / WebView2 (Chromium/Edge)

The Gamepad API is a Chromium feature, so WebView2 has it, subject to a WebView2-specific history worth knowing:

* WebView2Feedback issue **#3025, "Gamepad API only works when developer tools is opened"** (opened 2022-12-06, runtime 107.0.1418.62): the gamepad worked only while DevTools had focus. The reporter reproduced it on WebView2 via both Photino and WinForms. Microsoft fixed it in **Edge 112**: "the fix for that issue just landed in Edge 112.0.1689.0… canary" (2023-02-20), and the issue was **closed as completed** on 2023-04-13 after the reporter confirmed "gamepad works in webview" ([MicrosoftEdge/WebView2Feedback #3025](https://github.com/MicrosoftEdge/WebView2Feedback/issues/3025)).

So: **works on WebView2 ≥ 112**, i.e. any current WebView2 runtime. `[inference]` The original bug was about keyboard focus: the gamepad stream is only read while the WebView2 control has focus, which a normal full-window Tauri app has.

Secure context: Tauri serves the app over a built-in scheme — `<scheme>://localhost` on macOS/Linux and `http(s)://<scheme>.localhost` on Windows and Android, with `useHttpsScheme` defaulting to **false** (`crates/tauri-utils/src/config.rs`: "Sets whether the custom protocols should use `https://<scheme>.localhost` instead of the default `http://<scheme>.localhost` on Windows and Android. Defaults to `false`."). Under the Secure Contexts algorithm, an origin whose host is `localhost` or ends in `.localhost` — and a scheme the user agent considers authenticated — is **potentially trustworthy**, so the window is a secure context ([W3C Secure Contexts §3.1](https://w3c.github.io/webappsec-secure-contexts/)). `[inference]` The window therefore satisfies the secure-context precondition on Windows.

### 3.2 Linux — Tauri 2 / WebKitGTK (including WSLg)

**The Gamepad API is off by default in WebKitGTK.** WebKit's own preference table has:

```yaml
GamepadsEnabled:
  humanReadableName: "Gamepads"
  humanReadableDescription: "Web Gamepad API support"
  condition: ENABLE(GAMEPAD)
  defaultValue:
    default: false
    WebKit: true
```

— `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` ([raw](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml)). `status:` is `embedder`, and `disableInLockdownMode: true`. There is **no** `WebKitGTK:` override, so the GTK port falls to `default: false`. The GTK port has *compiled* a Gamepad backend since 2012 ([WebKit bug 87503, "\[Gtk\] Add support for the Gamepad API"](https://bugs.webkit.org/show_bug.cgi?id=87503); the change set `ENABLE_GAMEPAD` default to `isGtk()`), but the runtime preference is off unless an embedder turns it on — and Tauri does not.

This matches the ecosystem: Tauri's own community plugin exists precisely to fill the gap, and its README states the reason:

> "By default WebKit does not support all the joysticks and gamepads, especially on Safari (macOS and iOS). It does support a bit more in Chrome's version of WebKit, but that's not the one used by Tauri. Therefore this plugin was created to bridge this gap…"
> — [`DeveloperMindset-com/tauri-plugin-gamepad`](https://github.com/DeveloperMindset-com/tauri-plugin-gamepad) (MIT, built on the Rust `gilrs` crate; supports Linux/BSD evdev, Windows XInput, macOS, iOS — **not** Android)

WSLg is just WebKitGTK under Linux, so it inherits the same "off by default". `[inference]` **On Linux the Gamepad API is effectively unavailable in the Tauri window; a gamepad there needs the Rust side** (the `gilrs`-style polyfill the plugin uses, or a direct read) **rather than the webview.**

### 3.3 The companion page in a phone's browser

The companion is served by `crates/host-wire` as **plain HTTP on the Host's LAN address** — `server.rs` binds a `TcpListener`, and `remote.rs` writes the page with no TLS; ADR-0017 describes "a duplex WebSocket on the Host's LAN address" and a manual `host:port`. A LAN HTTP origin (`http://192.168.x.y:port`) is **not** a secure context (only `https`, `localhost`/`*.localhost`, `127.0.0.0/8`, `::1`, `file`, and UA-authenticated schemes are — [W3C Secure Contexts §3.1](https://w3c.github.io/webappsec-secure-contexts/)). Consequences:

* **A gamepad paired by Bluetooth to the phone will not be seen by the companion page.** `navigator.getGamepads()` returns an empty array / throws in Chromium and Firefox on an insecure origin, and `gamepadconnected` never fires ([Mozilla Hacks](https://hacks.mozilla.org/2020/07/securing-gamepad-api/); [Chromium 40221455](https://issues.chromium.org/issues/40221455); [MDN, `getGamepads()`](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads)).
* The only way to change that is to serve the companion over `https` (or open it on the phone at `localhost`, which is not how it is used). This is a **real constraint on the current design**, not a browser quirk.
* The phone's **touch UI keeps working** regardless — none of this affects taps.

`[inference]` The practical reading for the companion is: the phone is driven by touch and by the gamepad **only if** the page is later served over a secure context; the remote's own key events (a physical TV remote on the phone, or a keyboard) also work because key events are not gated by secure context.

### 3.4 Desktop Chrome / Firefox

On `https://` or `http://localhost` the Gamepad API works in both engines, with the caveats already stated: a **user gesture** is required before anything is exposed (spec §4.1), and Firefox additionally requires the interaction to happen **while the page is visible**. Both require a secure context. Neither delivers raw gamepad data through `keydown`.

### 3.5 Android WebView / Android TV (Tauri on Android)

Chromium-based Android WebView inherits Chromium's Gamepad API, but a phone/TV pad is usually the D-pad, which Android delivers as **real key events** (§2.2) — so a keydown handler is the correct seam there. The exceptions are the ones §2.4 names: `BACK` is the host Activity's, and JS only sees `"GoBack"` if the app forwards it. The `gilrs` plugin backing the Tauri polyfill explicitly lists Android as unsupported (`✕` in its README), so on Android the Gamepad API is the browser's own.

---

## 4. What the old shell's input handling covered, and missed

> This section and §4.1 describe the shell as it stood when the note was written.
> Its `src/useArrowKeys.ts` was removed at the #87 cutover; the ten-foot shell's
> `src/shell/useSpatialFocus.ts` reads that file's findings and adds the gamepad
> and spatial movement it called for.

### 4.1 Covered, at the time

`src/useArrowKeys.ts` listened on `document` for `keydown` and:

* `ArrowRight` / `ArrowLeft` — move to the next/previous `[data-focusable]` in DOM order, wrapping; **Left/Right are yielded to the caret when the focused control is a text field**.
* `ArrowDown` / `ArrowUp` — same move, and they still move when a text field is focused (the comment calls this "how a remote with no Backspace leaves the field at all").
* `Escape` — calls `back()`.
* `Backspace` — calls `back()` when the focused control is **not** a text field.
* `Enter` / `Space` on the focused control — **not handled here on purpose**: the comment says "OK is the button's own Enter or Space — nothing here re-implements activating a control, so every control that works with a mouse works with a remote too." A focused `<button>` therefore activates natively on Enter (keydown) and Space (keyup).

The companion page (`crates/host-wire/remote/index.html`) has only a single keyboard listener: `Escape` closes the controls sheet when it is open (`document.addEventListener("keydown", …)` at line ~1586). **It has no arrow-key navigation and no `data-focusable` convention** — the companion cannot currently be driven by a D-pad or a remote's arrows at all.

### 4.2 Missed, for a gamepad/dpad

* **No Gamepad API at all.** A gamepad's D-pad, sticks and buttons emit **no key events**, so the old shell's keyboard handler never saw them. On Windows/Linux this is the whole gap; on Android TV and for IR remotes it does not apply.
* **No polling loop, no `gamepadconnected` / `gamepaddisconnected`,** no `gamepad.mapping === "standard"` check, no axis dead-zone/edge-detection (a stick must be turned into discrete move steps, not a key-repeat flood).
* **No transport or menu intents.** Play/pause, seek back/forward, stop and menu have no mapping in either client. The window's playback controls are only reachable by moving focus to the control and pressing Enter.
* **No `"GoBack"`.** The Android Back key value is not handled anywhere; the old handler took `Escape` and `Backspace` only.
* **No media keys.** `"MediaPlayPause"`, `"MediaRewind"`, `"MediaFastForward"`, `"MediaStop"`, `"ContextMenu"`, `"Accept"` are all unhandled.
* **DOM order, not geometry.** Movement is `querySelectorAll` order, so a D-pad moves through the controls in reading order rather than by spatial direction. `[inference]` For a poster wall or a grid this will feel wrong (a Right press after the last card of a row jumps to the next row's first card only because that happens to be DOM order).

---

## 5. Proposed default BUTTON → INTENT table

This is a **proposal**, not a fact — the issue asks for one. It is deliberately one table with two source columns, so the React window (which can use the Gamepad API) and the hand-written companion page (which can only use key events) share the same **intents**; each client reads whichever column its platform can actually deliver. The intents are the ones the issue names.

| Intent | Standard gamepad button index/indices | Standard gamepad axis | `KeyboardEvent.key` value(s) |
|---|---|---|---|
| **move-up** | 12 (D-pad up) | axis 1 `< -0.5` | `"ArrowUp"` |
| **move-down** | 13 (D-pad down) | axis 1 `> 0.5` | `"ArrowDown"` |
| **move-left** | 14 (D-pad left) | axis 0 `< -0.5` | `"ArrowLeft"` |
| **move-right** | 15 (D-pad right) | axis 0 `> 0.5` | `"ArrowRight"` |
| **activate** | 0 (bottom-right / A · Cross) | — | `"Enter"`, `" "` (Space — native activation) |
| **back** | 1 (right-right / B · Circle), 8 (View · Back · Share) | — | `"Escape"`, `"Backspace"` (when not typing), `"GoBack"` |
| **play/pause** | 2 (left-right / X · Square) | — | `"MediaPlayPause"`, `"MediaPlay"`, `"MediaPause"` |
| **seek back** | 4 (LB · L1), 6 (LT · L2, analog `value`) | — | `"MediaRewind"` |
| **seek forward** | 5 (RB · R1), 7 (RT · R2, analog `value`) | — | `"MediaFastForward"` |
| **stop** | 3 (top-right / Y · Triangle) | — | `"MediaStop"` |
| **menu** | 9 (Menu · Start · Options), 16 (Guide · Home) | — | `"ContextMenu"` |

Notes that make the table usable:

1. **Precondition:** only trust the index column when `gamepad.mapping === "standard"`; otherwise the indices are device-specific.
2. **Movement from a stick** is not a key: turn `axes[0]`/`axes[1]` into one move per crossing of a threshold (e.g. ±0.5) with a repeat delay, or the stick will fire dozens of moves. Read the D-pad buttons (12–15) **and** the axes, and de-duplicate.
3. **Triggers are analog:** use `button.value` (0..1) to scale the seek rate; `button.pressed` is only the boolean above the UA's press threshold.
4. **Button 16 (Guide/Home)** is usually captured by the console/OS and never delivered to the page — treat it as best-effort, never the only path to **menu**.
5. **`"Accept"`** is an alias Android uses for `KEYCODE_DPAD_CENTER`; treat `"Enter"` and `"Accept"` identically for **activate**.
6. **Left/Right vs seek.** In a playback surface, Left/Right arrows commonly mean *seek* rather than *move*; the mapping above keeps them as **move** and puts seek on the media keys and shoulders. `[inference]` A player overlay that owns the arrows should decide by context, not by changing the table.
7. **Sharing it across two codebases.** ADR-0017 keeps the companion a single file with no build step, so the table cannot be imported from `src/`; the workable shape is one pure, testable TypeScript table in `src/` (for the window) mirrored by hand in `remote/index.html` (for the companion), the same way the companion already mirrors the pure decisions of `src/*.ts`. A test can assert the companion's copy matches — the precedent is `host-wire::remote`'s existing assertion that the companion's capability list equals `Action::SPELLINGS`.

---

## 6. What is NOT deliverable (the negatives)

* **A gamepad cannot be read from `keydown`.** No DOM key events are produced by a gamepad; it is the Gamepad API or nothing (W3C §1, §4.1).
* **The Gamepad API does not work on an insecure origin**, including the companion's current `http://<LAN-ip>:<port>`. Chromium and Firefox both block it there ([Mozilla Hacks](https://hacks.mozilla.org/2020/07/securing-gamepad-api/), [Chromium 40221455](https://issues.chromium.org/issues/40221455), [MDN](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts)).
* **On Linux (WebKitGTK, incl. WSLg) the Gamepad API is off by default** and Tauri does not enable it ([WebKit `UnifiedWebPreferences.yaml`](https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml); [tauri-plugin-gamepad](https://github.com/DeveloperMindset-com/tauri-plugin-gamepad)).
* **You cannot poll a gamepad until the user touches it** (spec gesture), and in Firefox not until they touch it with the page **visible** (MDN).
* **Polling stops when the window is hidden** — `requestAnimationFrame` is paused in background/hidden contexts (MDN).
* **The browser Back button cannot be prevented** — only observed after the fact via `popstate`, which may not even fire on the first interaction (MDN).
* **Android `BACK` is not a webview key you can rely on** — the host Activity owns it; JS sees `"GoBack"` only if the app forwards it (Android Developers Blog).
* **Volume keys (`"AudioVolumeUp"`/`"AudioVolumeDown"`/`"AudioVolumeMute"`) are generally swallowed by the OS/hardware**, not delivered to a full-screen webview page; they are deliberately absent from the table.
* **Media keys on a physical keyboard may be captured by the OS media session** before the page sees them (e.g. `MediaPlayPause` controlling the system player). `[inference]` Treat media-key intents as best-effort.
* **No trusted synthetic gamepad input exists.** There is no `dispatchEvent` that produces a `Gamepad` reading, and synthetic `KeyboardEvent`s are `isTrusted === false`.

---

## 7. Could not confirm

* **The exact current WebKitGTK behaviour at runtime** beyond the preference default. The preference table says `GamepadsEnabled` defaults to `false` for non-WebKit ports and is an `embedder` feature, and the ecosystem reports it not working in WebKit2GTK/Tauri; I did **not** run a WebKitGTK build with a pad attached to observe it directly.
* **iOS Safari support for third-party Bluetooth pads.** WebKit bug 205448 ("navigator.getGamepads() returns empty array in my WKWebView app") was resolved **WORKSFORME** with "It's not expected the DS4 would work on iOS 12. It works on iOS 13+", i.e. the API works in principle on modern iOS WebKit but the report was an OS-version limit ([WebKit bug 205448](https://bugs.webkit.org/show_bug.cgi?id=205448)). Whether a given current iOS browser exposes a given pad was not verified.
* **Whether WebView2 exposes the guide/home button (index 16)** through the Gamepad API; OS reservations are documented only informally.
* **The precise Tauri origin string per platform in this build** (dev serves `http://localhost:1420`; production uses the custom protocol). The secure-context conclusion holds either way, but I did not run the built app to read `location.origin`.

---

## 8. Sources

Specifications and references
* W3C, **Gamepad**, Working Draft 10 July 2025 — <https://www.w3.org/TR/gamepad/> (interface, standard mapping §14, gesture §4.1, axes/buttons §3.3–3.5)
* W3C, **Secure Contexts**, Editor's Draft — <https://w3c.github.io/webappsec-secure-contexts/> (§3.1 potentially-trustworthy origins)
* MDN, **Gamepad API** — <https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API>
* MDN, **Using the Gamepad API** — <https://developer.mozilla.org/en-US/docs/Web/API/Gamepad_API/Using_the_Gamepad_API>
* MDN, **`Navigator.getGamepads()`** — <https://developer.mozilla.org/en-US/docs/Web/API/Navigator/getGamepads>
* MDN, **Key values for keyboard events** — <https://developer.mozilla.org/en-US/docs/Web/API/UI_Events/Keyboard_event_key_values>
* MDN, **Features restricted to secure contexts** — <https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Secure_Contexts/features_restricted_to_secure_contexts>
* MDN, **`Permissions-Policy: gamepad`** — <https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Permissions-Policy/gamepad>
* MDN, **`Window: popstate`** — <https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event>
* MDN, **`Window.requestAnimationFrame()`** — <https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame>

Platforms and bugs
* MicrosoftEdge/WebView2Feedback **#3025** — <https://github.com/MicrosoftEdge/WebView2Feedback/issues/3025>
* WebKit bug **87503** (\[Gtk\] Gamepad API) — <https://bugs.webkit.org/show_bug.cgi?id=87503>
* WebKit bug **205448** (WKWebView getGamepads) — <https://bugs.webkit.org/show_bug.cgi?id=205448>
* WebKit `Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml` — <https://raw.githubusercontent.com/WebKit/WebKit/main/Source/WTF/Scripts/Preferences/UnifiedWebPreferences.yaml> (`GamepadsEnabled`)
* Tauri `crates/tauri-utils/src/config.rs` (`use_https_scheme`) — <https://raw.githubusercontent.com/tauri-apps/tauri/dev/crates/tauri-utils/src/config.rs>
* `DeveloperMindset-com/tauri-plugin-gamepad` — <https://github.com/DeveloperMindset-com/tauri-plugin-gamepad>
* Chromium issue **40221455** — <https://issues.chromium.org/issues/40221455>
* Mozilla Hacks, **Securing Gamepad API** (2020-07-01) — <https://hacks.mozilla.org/2020/07/securing-gamepad-api/>
* Android Developers Blog, **Back and other hard keys: three stories** — <https://android-developers.googleblog.com/2009/12/back-and-other-hard-keys-three-stories.html>
* LogRocket, **WebView and Android back button navigation** — <https://blog.logrocket.com/customize-androids-back-button-navigation-webview/>
* Linux kernel, **Remote controller tables** — <https://www.kernel.org/doc/html/v4.9/media/uapi/rc/rc-tables.html>

This repository
* `src/shell/useSpatialFocus.ts` — the keydown and gamepad handler that replaced the old shell's `src/useArrowKeys.ts` (the subject of §4, removed in #87).
* `crates/host-wire/remote/index.html` — the single-file companion (`Escape` only).
* `crates/host-wire/src/server.rs`, `remote.rs`; `docs/adr/0017-pairing-and-the-wire-protocol.md` — the companion is plain HTTP on the LAN.
* `docs/research/gui-toolkit-performance-multiplatform.md` §0, §3 — Tauri version and webview engines.
