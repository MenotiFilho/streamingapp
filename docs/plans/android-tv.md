# The Host on Android TV and Fire TV: the plan

**Decision:** ADR-0040 (proposed). **Branch:** `android-tv`, the home of this
work until it lands or moves to its own repository (§5). **State:** planned;
nothing built.

## 1. What we are building, and why this shape

The owner wants streamingapp on the TV, on an Android TV box or a Fire TV
Stick, on the local network only. The TV runs **the whole Host**. It browses,
plays with the platform player (Media3) and serves the Remote, so a phone pairs
with the TV the way it pairs with a PC today. No PC needs to be on, and no rule
of the Host changes: the Stream URL never leaves the Host, because the Host is
the TV.

Three shapes were weighed, and ADR-0040 records why the other two lost:

| Shape | Verdict |
|---|---|
| **Host on the TV** (standalone) | **chosen.** It reuses the seams, keeps every ADR, and needs no PC. |
| TV as a client of a PC Host, playing locally | rejected. The PC must be on, and it needs two rule changes (the URL leaves the Host; a client owns playback). |
| Host in the cloud | out of scope. It needs TLS on the wire, a new pairing flow and server-side credentials, and debrid may lock links to an IP. |

## 2. What changes, seam by seam

`host-core` is the Host's domain and is expected to stay as it is. The one
planned addition is the Player declaring its supported Tellings (ADR-0040 §2).
Everything else is a new implementation or the shell.

| Part | Desktop today | Android TV |
|---|---|---|
| Shell | `src-tauri` (Tauri 2 desktop) | Tauri 2 Mobile Android target, composing the `Host` as `main.rs` does |
| `Player` | `host-mpv`: libmpv, `wid` child window | Kotlin Tauri plugin over **Media3**; `SurfaceView` behind a transparent WebView |
| `Previewer` | second silent libmpv | none at first: the client already draws "cannot" |
| `Fetcher` / Stremio API | `ureq` + native-tls | `ureq` + **rustls + platform verifier** (all platforms) |
| `Store` | rusqlite bundled | same |
| `SecretStore` | keyring or 0600 file | 0600 file in app-private storage (Keystore later) |
| Wire + mDNS | `host-wire` | same, with a `MulticastLock` held by the shell |
| Window UI | `src/window` (ten-foot, D-pad focus) | same, plus Android Back → Level pop |
| Remote | served by the Host | same, served by the TV |
| Release | NSIS `.exe` via `scripts/cd.sh` | signed APK beside it |

## 3. The tickets, in order

Each one is one pull request into `android-tv`, with its own gate. They are
filed as children of one spec issue when the owner says go.

1. **Spike: the client on the devices.** An APK from Tauri 2 Mobile that runs the
   ten-foot window in rehearsal mode (`VITE_UI=rehearsal`, `previewHost.ts`, no
   Host) on a Fire TV Stick and an Android TV device. It measures:
   - which version of the Amazon WebView is on the stick, and whether React 19
     and our CSS run there;
   - the D-pad and the Back key reaching the focus engine;
   - frame time on Home and the Title page on the weakest target stick;
   - a transparent WebView over a `SurfaceView` playing a test file.

   *Gate:* a short research note in `docs/research/android-tv-spike.md`.
   ADR-0040 is accepted or amended from it.
2. **Portable TLS.** `host-addon` (and `HttpStremio`) on rustls +
   `rustls-platform-verifier`. *Gate:* `cargo test` green, `live_check` against
   a real https Addon, and a Windows `verify.ps1` walkthrough (back up
   `%APPDATA%\dev.streamingapp.host` first) with no regression.
3. **The Player says what it takes.** The `host-core` addition from ADR-0040 §2:
   the Player declares its supported Tellings, the Snapshot carries them, and
   both clients draw unsupported controls as unavailable. The desktop declares
   everything, so nothing changes there. *Gate:* `host-core` tests with a
   `FixturePlayer` that declines some Tellings, plus window and Remote decision
   tests.
4. **The Android shell.** A Tauri 2 Mobile target that builds the Host: the app
   data directory, `SqliteStore`, `host_secret::open`, `HttpFetcher`, the wire
   server with the multicast lock, and the 250 ms sampling and 500 ms drain
   clocks. It uses a `NoPlayer` for now. *Gate:* on a device, add an Addon,
   browse, open a Title, list Streams, and pair a phone.
5. **The Media3 Player.** A Kotlin plugin implementing open, stop, `tell` and
   reports, with tracks, subtitles (external URLs as well), speed, volume,
   chapters and seek. It renders `Picture::InWindow` behind the WebView.
   *Gate:* play a direct-URL Stream, resume from Continue watching after an app
   restart, and drive pause and subtitles from the phone.
6. **TV polish.** A Leanback manifest (the `LEANBACK_LAUNCHER` category, a
   320×180 banner, touchscreen not required), Back mapped to the Level pop,
   HDR10/DV output and audio passthrough checked on a capable TV. *Gate:* a
   hand checklist like `verify.ps1`, with photos of the TV's HDR indicator.
7. **Release.** `scripts/cd.sh` also builds a signed APK and attaches it to the
   GitHub Release, for sideloading on Fire TV. The Amazon Appstore comes later.
   *Gate:* a fresh install on a reset stick from the Release asset.

Not on this route: playing on the phone, the cloud Host, and Host-to-Host
progress sync (Account sync already covers progress when signed in).

## 4. How it is verified

- The Rust and TypeScript suites run as today in the dev container. The
  container cannot run an emulator with a GPU, so device behaviour is checked
  by hand, as the Windows window is.
- Windows must not regress: tickets 2 and 3 touch shared code, and each is
  walked on Windows before it merges into `android-tv`.
- On the devices: install the APK, add an Addon, play a 4K HDR Stream (the TV
  shows its HDR badge), pair a phone at the address the TV shows, pause and
  switch subtitles from the phone, restart the app and resume from Continue
  watching.

## 5. Staying on this branch, or moving to a new repository

This branch is the integration branch for the TV work. `main` is merged into it
regularly, and it merges back only when the app is worth shipping. The landing
rules in `AGENTS.md` still apply to each ticket's PR into this branch.

If the TV app moves to its own repository, the split follows the seams:

- **It stays here:** `crates/host-core` and the platform-neutral crates
  (`host-sqlite`, `host-secret`, `host-wire`, `host-addon`, `host-logging`),
  `src/core`, `src/kit`, `src/window`, `src/remote`.
- **It moves:** the Android shell, the Media3 plugin, the Android build and
  release scripts, ADR-0040 and this plan.
- **How the new repo consumes the shared code:** the crates as a Cargo git
  dependency pinned to a tag. The client as a git submodule or a published
  package. Deciding between those two is the first ticket of the move.

Keeping it as one repository is cheaper while ticket 3 (a `host-core` change)
and the shared client are still moving. The move is easiest after ticket 5,
once the seams have proven they hold.
