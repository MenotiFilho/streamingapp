# Marquee Host behaviours and protocol decisions

[ADR-0043](0043-the-marquee-design-system-supersedes-repertory.md) §4 listed the
places where the Marquee drawing asks for behaviour beyond what `main` does and
deliberately refused to decide them in a design record. Implementation map #352
and ticket #353 close those Host and protocol questions ahead of Wave 1
(#355–#357) so every client and Host slice implements one agreed contract.

This reaffirms [ADR-0009](0009-blocking-fetcher-addon-identity-and-the-manifest-url.md),
amends [ADR-0024](0024-subtitle-appearance-is-a-preference.md) §3 and §5, and
extends [ADR-0015](0015-watch-progress-the-library-and-resume.md) and
[ADR-0041](0041-the-host-chooses-the-track.md). Existing
[ADR-0038](0038-the-title-cache-is-kept-on-disk-and-refreshed-behind-the-client.md)
cached `titles` rows stay valid without a cache wipe.

## 1. Addon details preserves ADR-0009 (no URL exposure, no background probing)

An Addon's manifest URL remains a credential by presumption and never leaves the
Host in a Snapshot or log (ADR-0009). The Marquee Addon details Level displays
only the fields already carried in `Manifest`: `Version`, `Id`, `Resources`
(labelled **Serves**), `Types`, and `Catalogs`.

Neither the manifest URL, its origin, nor its domain is added to `Snapshot`, and
the Host runs no background health-check probe and exposes no `OFFLINE` status
on Addons. Whether an Addon is reachable is still learned only when an Action
actually asks it, and reported on that Row or Stream answer.

Rejected, with reasons: **exposing the manifest URL, origin, or domain in
`Snapshot`** (violates ADR-0009: a Snapshot reaches every paired Remote client,
and even a hostname or domain leaks private Addon endpoints while splitting a
secret across two shapes); **adding a background probe to draw an `OFFLINE`
badge** (sends unsolicited periodic traffic to every configured Addon —
including rate-limited or debrid-backed endpoints — adds stale health state to
`Snapshot`, and breaks ADR-0009's rule that the Host contacts an Addon only on
an Action).

## 2. Addon enable/disable (`set_addon_enabled`)

An owner can switch a configured Addon off without removing it, keeping its
manifest URL and configured order intact for later re-enabling.

- **Persistence and Snapshot:** SQLite stores `addons.enabled INTEGER NOT NULL
  DEFAULT 1` (forward-only migration, so every configured Addon starts enabled).
  `enabled: bool` is carried on `Addon` and on each Addon entry in `Snapshot`,
  and mutated by the Change Action `Action::SetAddonEnabled { addon, enabled }`
  (`set_addon_enabled`). Reconfiguring an existing Addon through `add_addon`
  preserves its current `enabled` state rather than silently re-enabling it.
- **Skipped across fan-outs and fallbacks:** disabled Addons are skipped by
  Catalog listings, `SearchCatalogs`, `FindStreams`, the external `subtitles`
  fallback, and `Resume` / `first_playable` Stream resolution.
- **Featured catalog kept while suppressed:** the `featured_catalog` preference
  stays stored when its Addon is disabled (unlike `remove_addon`, which clears
  it). While that Addon is disabled, the Featured catalog is suppressed so no
  client draws a Home hero from it; re-enabling the Addon restores the Home hero
  automatically.
- **Continue watching stays listed with a distinct reason:** Continue watching
  entries whose supplying Addon is disabled remain listed (a mark, not a hiding
  — ADR-0015), marked unplayable with `UnplayableReason::AddonDisabled`
  (`addon_disabled`), distinct from `UnplayableReason::AddonRemoved`
  (`addon_removed`), so a client can distinguish a switched-off Addon from a
  removed one.
- **Direct targeting refused:** `open_title`, `browse_catalog`, `resume`, and
  continuity Actions (`next_episode`, `previous_episode`, `play_up_next`) refuse
  cleanly when targeting a disabled Addon.

Rejected, with reasons: **reusing `addon_removed` for disabled Addons** (tells
the owner an Addon was uninstalled when toggling one switch restores the Title);
**clearing `featured_catalog` on disable** (makes a reversible toggle
destructively erase a separate preference); **hiding disabled Addons only in the
client** (leaves `SearchCatalogs`, `FindStreams`, external subtitles, `Resume`,
and continuity asking disabled Addons and puts Host rules in clients against
ADR-0002); **resetting `enabled` to `true` on `add_addon`** (reconfiguring an
Addon's URL should not quietly turn on an Addon the owner turned off).

## 3. Player Streams switcher (`switch_stream`)

Marquee adds a **Streams** Level inside the Player so the owner can switch to
another Stream for the current Video without leaving playback.

- **Dedicated Change Action:** `Action::SwitchStream { addon, stream }`
  (`switch_stream`) is a Change Action. The client supplies only the chosen
  `addon` and `stream`; the Host reads the active `Video`, `TitleStub`, and
  current **Playback position** from its playback session, opens the replacement
  Stream at that position, and **preserves the Title's `HandPick`** because the
  Title has not changed (ADR-0041).
- **Starts playing even when paused:** switching a Stream resumes playback even
  if Playback was paused when the replacement was chosen.
- **Synchronous refusal leaves playback untouched:** if nothing is playing, the
  Action fails validation, or the Torrent engine refuses `serve` synchronously,
  the Host refuses the Action and keeps the current Stream playing untouched.
- **Asynchronous open failure preserves place:** once `loadfile replace` has
  been told to the Player, an asynchronous open failure transitions to standard
  `Idle` with `failure` set, while preserving `now_playing` and `WatchProgress`
  at the saved Playback position so the owner can pick another Stream or resume
  without losing their place.

Rejected, with reasons: **overloading `play_stream` with a client-supplied start
position** (lets clients pass arbitrary positions outside the Host's own record,
repeats `Video` and `TitleCard` the Host already holds, and would treat a
same-Title switch as a new play that drops `HandPick` — against ADR-0002 and
ADR-0015); **keeping Playback paused after a Stream switch** (freezes the newly
picked Stream after an explicit play intent); **attempting to reopen the prior
Stream on an async failure** (a Stream URL is never kept after open — ADR-0013 —
and the previous connection or torrent may already be gone; landing in `Idle` +
`failure` with saved `WatchProgress` matches every other open failure).

## 4. Subtitle sync (±0.1 s + Reset) is strictly per-Stream

Marquee's Player Audio & Subtitles Level exposes subtitle timing sync in `0.1 s`
steps with a **Reset** (`0 s`) control. `Action::SetSubtitleDelay`,
`Telling::SubtitleDelay`, `PlaybackSnapshot.subtitle_delay`, and `0.1 s`
stepping already exist; what changes is the lifetime of a non-zero delay.

Subtitle delay is strictly per-Stream — never a persisted preference. Because
mpv retains `sub-delay` across `loadfile replace`, `host-mpv`'s
`telling::opening()` resets `sub-delay` to `0` on every new Stream open beside
its existing `aid=auto` and `sid=auto` resets. A timing correction for one
subtitle Track therefore never leaks across episodes, switched Streams, or
later Titles.

Rejected, with reasons: **persisting `subtitle_delay` as a Host preference**
(sync offset is a property of one mismatched subtitle Track and release, not a
room setting, and carrying it forward breaks properly timed Tracks); **sending a
separate `Telling::SubtitleDelay { seconds: 0.0 }` from `host-core` on every
open** (leaks mpv's sticky-property quirk across the Player seam; resetting in
`host-mpv::telling::opening()` keeps mpv's own clean-slate rules in one place,
just like `aid` and `sid` in ADR-0041).

## 5. Subtitle size widens to 25%–300% in 5% steps (amends ADR-0024 §3 and §5)

Marquee replaces the four fixed subtitle size chips with a 5% stepper spanning
25% to 300%, amending [ADR-0024](0024-subtitle-appearance-is-a-preference.md) §3
and §5:

- **`SubtitleScale` bounds widen to `0.25..=3.0`** (from `0.5..=2.0`), verified
  against real `libmpv` in `host-mpv` tests. Non-finite and out-of-range values
  are still refused in `Action::validate` with `invalid_subtitle_scale` before
  reaching the Player, store, or Snapshot.
- **One 5% (`0.05`) stepper everywhere:** both Settings and the Player's Audio &
  Subtitles Level — on the window and on the Remote client — replace the four
  preset chips and preset ladder with a 5% stepper clamped to `0.25..=3.0`,
  keeping `1.0` (100%) as the default. The shared appearance JSON
  (`src/subtitle-appearance.json`) carries the bounds and step so both clients
  stay aligned by construction.

The rest of ADR-0024 stands: Subtitle appearance stays two Host preferences,
`sub-ass-override` stays deliberately unset, and the Player is told at startup
and on every change.

Rejected, with reasons: **keeping `0.5..=2.0` in `host-core` while drawing
25%–300% in the UI** (silently caps or refuses values the approved Marquee
interface offers); **keeping four preset chips in Settings with a 5% stepper
only in the Player** (recreates the mismatch ADR-0024 §5 avoided, forcing
Settings into an "Other (n%)" fallback for normal Player adjustments); **leaving
`SubtitleScale` unbounded** (unbounded floats risk unusable libass rendering,
whereas `0.25..=3.0` covers every viewing distance and is pinned against real
`libmpv`).

## 6. Episode description in `Video`

Marquee's Title surface shows each episode's description beside its still and
number. `Video` in `crates/host-core` gains `#[serde(default)] description:
Option<String>`, mirrored in `src/core/wire.ts`:

- In the Addon meta parser (`crates/host-core/src/meta.rs`), `description` is
  populated from `overview` with fallback to `description`, trimming empty or
  whitespace-only values to `None`.
- In the TMDB parser (`crates/host-core/src/tmdb.rs`), it is populated from
  `overview`, likewise trimming empty values to `None`.
- Existing cached `titles` rows in SQLite (ADR-0038) remain valid because
  `#[serde(default)]` deserializes missing descriptions as `None`, and they
  populate naturally as Titles refresh — with no destructive cache wipe and no
  schema migration.

Rejected, with reasons: **wiping the `titles` table in a migration to repopulate
descriptions immediately** (destroys offline Continue watching / Up next caches
and causes an unnecessary burst of Addon and TMDB round trips on upgrade);
**reading only `overview` from Addons** (Stremio Addons use both `overview` and
`description` on episode entries; checking `overview` then `description` handles
both).

## 7. Opening logo fill and `TitleStub.logo`

Marquee's Opening surface fills the Title's wordmark logo while a Stream opens
(falling back to the Title's name over a bar when no logo is present), and
Continue watching Wide cards draw the logo over the 16:9 backdrop.

- **Client-side phase animation:** the Host adds no numeric opening-progress
  field to `PlaybackSnapshot`. Clients animate the logo fill from the phases the
  Snapshot already reports: `opening` → `finding` → `fetching` → `playing`
  (`PlaybackState::Opening`, `TorrentStatus.phase`, and
  `PlaybackState::Playing`). Direct Streams step from `opening` to `playing`;
  torrent Streams step through `finding` and `fetching` in between. A spinner is
  drawn only while `stalled` is true during playback.
- **Optional `logo` on `TitleCard` and `TitleStub`:** both types gain
  `#[serde(default)] logo: Option<String>` (bounded like `poster` and
  `background`, and mirrored in `src/core/wire.ts`), persisted in SQLite via a
  forward-only migration adding `watch_progress.title_logo TEXT` and exposed
  through `ContinueEntry`, `ResumeEntry`, and `now_playing`. Continue watching
  Wide cards and the Opening surface therefore have the Title's wordmark offline
  and when playback was started by another client.

Rejected, with reasons: **adding a numeric `opening_progress` percentage to
`PlaybackSnapshot`** (neither mpv nor the Torrent engine supplies a true linear
percentage while opening; inventing a synthetic percentage in the Host would
turn a presentation animation into misleading shared state); **looking up the
logo lazily from the Title cache or an Addon when Opening begins** (makes
Opening artwork depend on cache presence or network availability and breaks when
playback starts from a Remote client for an uncached Title; carrying `logo` on
`TitleCard` / `TitleStub` follows the exact offline pattern of `poster` and
`background` in ADR-0015).

## Consequences

- `host-core` gains `Action::SetAddonEnabled` and `Action::SwitchStream` (and
  updates `Action::SPELLINGS` and the Remote client's parity list — ADR-0018),
  `UnplayableReason::AddonDisabled`, `SubtitleScale` bounds `0.25..=3.0`,
  `Video.description`, and `TitleCard.logo` / `TitleStub.logo`.
- `host-sqlite` adds forward-only migrations for `addons.enabled` (default `1`)
  and `watch_progress.title_logo`; cached `titles` rows need no migration.
- `host-mpv` resets `sub-delay` to `0` in `telling::opening()` and pins
  `sub-scale` at `0.25` and `3.0` against real `libmpv`.
- Both clients (window and Remote client) and `src/subtitle-appearance.json`
  adopt the 5% subtitle size stepper over `0.25..=3.0` and mirror the new
  Actions and optional fields in `src/core/wire.ts`.
- All seven open Host/protocol points from ADR-0043 §4 are now settled for Wave
  1 (#355–#357).
