# The Host runs on Android TV, and Media3 is its Player there

**Status: proposed.** Recorded on the `android-tv` branch so the work has a
decision to stand on. It becomes accepted when the spike (plan step 1) confirms
the device facts below. The route is `docs/plans/android-tv.md`.

The owner wants streamingapp on the living-room TV itself, on an Android TV box
or an Amazon Fire TV Stick, and only on the local network. There were three
shapes to choose from, and this records the one chosen and why.

## 1. The whole Host runs on the TV

The TV app is the **Host**, not a client of one. It holds the Addons,
preferences, credentials, Watch progress and the Title cache. It plays the
Stream itself and serves the Remote, so a phone pairs with the TV exactly as it
pairs with a PC Host today.

The architecture already allows it. `host-core` knows nothing about Tauri, the
network, SQL or mpv (ADR-0008, ADR-0009, ADR-0013). A new platform is
therefore new implementations of the existing seams plus a shell, and
`host-core` itself does not change, apart from the one addition named in §2.
If a ticket on this route finds it has to
change `host-core`, that is evidence a seam is wrong, and it is raised as
such rather than patched around.

Nothing about the one Action surface changes (ADR-0002). The window on the TV is
the same ten-foot client (`src/window`), and the phone is the same Remote
(ADR-0018, ADR-0035).

**Rejected, with reasons.**

- **The TV as a client of a PC Host, playing locally.** The PC must be on.
  Playing anywhere but the Host would need the Stream URL to leave the Host,
  and ADR-0009 and ADR-0013 keep it inside, because a URL can carry a debrid
  session. It would also need a playback session owned by a client, which
  ADR-0002 does not have. Two rule changes for a worse product.
- **A Host in the cloud.** The wire is plain `ws://` and paired from the Host's
  own screen (ADR-0017), the owner's credentials would live on an exposed
  server, and debrid services may refuse links resolved from one IP and played
  from another. The owner ruled it out of scope.

## 2. On Android, the Player is Media3

`host_core::Player` gets an Android implementation backed by **Media3
(ExoPlayer)** through a Kotlin Tauri plugin. ADR-0003 and ADR-0007 ("mpv owns
the swapchain", libmpv with `wid`) are **desktop decisions and stand
unchanged** there. On Android TV, the platform's own player is what reaches HDR10
and Dolby Vision output and audio passthrough (AC3/E-AC3/DTS) through the
display pipeline. The requirement those ADRs protect, HDR intact to the display,
is met by Media3 and not by compositing frames into the WebView.

The picture follows the Windows shape: a `SurfaceView` *behind* a transparent
WebView, `Picture::InWindow`. If the device's WebView cannot be made
transparent over a video surface, the spike says so and this section is
amended.

A **Telling** Media3 has no equivalent for (Autocrop, a Crop rectangle, perhaps
Aspect) must be refused, never faked. Today `PlaybackError` has only `Open` and
`Command`, and the Snapshot does not say which Tellings a Player takes, so this
is the **one expected addition to `host-core`**: the Player declares what it
supports, the Snapshot carries that, and clients draw the missing controls as
unavailable (ADR-0014, ADR-0027). It is a seam the desktop lacked only because
it had one Player, not a platform special case.
**Seek previews** (ADR-0028) are absent on Android at first. The seam already
lets a Previewer say "cannot", and clients already draw that as absent.

**Rejected, with reasons.** **libmpv-android**: it is proven (mpv-android) and
would keep one engine across platforms, but its HDR and audio passthrough on TV
hardware is weaker than the platform player's, and it adds a large native
build. It stays the fallback if Media3 cannot carry the Tellings the owner
cares about.

## 3. The transport speaks rustls

`host-addon` moves from `native-tls` to **rustls with
`rustls-platform-verifier`**, on every platform. `native-tls` on Android means a
cross-compiled OpenSSL. The platform verifier keeps the property the Windows fix
in `host-addon/src/lib.rs` was about: the OS's own trust store, not Mozilla's
list. The Windows build must show no regression, and the `verify.ps1`
walkthrough is the gate.

## 4. What is left as it is

- **Secrets.** There is no OS keyring, so `host-secret` falls back to its
  owner-only file in the app's private data directory, which Android already
  sandboxes. The Android Keystore can come later.
- **Store.** rusqlite (bundled) builds for Android unchanged.
- **Wire.** `host-wire` runs on the TV unchanged. mDNS needs a
  `WifiManager.MulticastLock` held by the shell while it announces.
- **Progress across devices.** A TV Host and a PC Host are two Hosts. Their
  Continue watching agrees through Account sync (ADR-0016) when the owner signs
  in to Stremio, and not otherwise. No Host-to-Host sync is built.

## Consequences

- A second shell target (Tauri 2 Mobile, Android) and a Kotlin plugin enter the
  build, along with an APK in the release.
- The capability set differs by Player: clients draw controls from what the
  Snapshot says the Player supports (§2), never from the desktop's set.
- The work may move to its own repository later. If so, the shared crates are
  consumed as a git dependency, and this ADR moves with the Android shell and
  plugin (see the plan, §5).
