# Repertory Player OSD: what survives, what is redrawn, what is cut

**Ticket:** #148 (wayfinder map #143). **Branch:**
`prototype/148-repertory-player-osd`, over the frame, Home, Title/Streams and
Addons/Settings/Library/pairing from #145–#147. **Run:** 2026-10-29.

This is the prototype's record, not an ADR. The map's direction, the frame, the
type pairing (Bodoni Moda / Inter / IBM Plex Mono) and the browse-screen anatomy
are already decided on #145–#147. What follows is how the in-window Player OSD
wears that direction **without losing one control or one behaviour**, and what
is still open for #150.

## The answer to the ticket's question

**Yes.** The OSD can lose the uosc-web look while keeping every control and the
whole behaviour. The control set is frozen and the implementation stayed one
component: `PlayerOverlay.tsx` still owns the one Snapshot reading, the one
Action path, the focus ladder, the auto-hide clock and the popover levels. The
repertory surface is a second drawing of the same DOM, selected by
`presentation === "repertory"`; the `shell-osd-*` test ids and the ten Actions
are unchanged, so the existing behaviour suite is the proof, not a rewrite.

## The composition: a programme note over the film

The picture stays the page. The OSD is printed over it, not laid on a glass
panel:

- **Top left, one line of programme.** A brass `Now playing` kicker, a hairline
  rule, and the episode (or `Feature`). Under it the Title in Bodoni Moda; the
  quality is a square brass stamp beside it; the Addon/codec/bitrate/decode
  facts are one mono line. The old pills become a note, a stamp and a ledger
  line.
- **Top right, the way out.** Fullscreen and Stop, each a square hairline
  control. Stop is the X again; its `aria-label` is still `Stop`, its meaning is
  still Back, and its Action is still `stop_playback`.
- **Right edge, the fader.** The volume is a bare vertical rail with a `Vol`
  label, the mono level, the slider and the mute mark. The glass box is gone.
- **Bottom, the console.** The five icon menus sit around the centred
  transport as before — Picture, Subtitles, Audio to the left; Speed and
  Chapters to the right. The transport keeps previous/next episode, −10 s,
  play/pause, +10 s. Every mark is bare; hover is a hairline, focus is the
  room's ivory keyline.
- **The timeline.** A hairline track with the buffered read behind it, the brass
  progress fill, an ivory playhead, brass chapter ticks in place of diamonds,
  and the two mono clocks — elapsed left, remaining right — with the current
  chapter named in the middle. The hover still, time and chapter callout stays.
- **The wait for mpv.** The opening art, its title and the `Opening …` note are
  re-dressed in the same type; the ended Stream's line becomes a printed plate.

## What survives visually

These are deliberate survivals, not leftovers:

- **The control set.** Stream/stats facts at the top, Stop/Back, fullscreen,
  the five per-icon menus, the volume slider and mute, previous/next episode,
  the two ten-second seeks, play/pause, the scrubber, the seek preview, the
  ended Stream's Next episode, and the inline refusal all remain.
- **The three stops of the ladder.** The picture button, the bottom strip and
  the top window pair keep their `data-player-stop` marks, so Up/Down still walk
  picture → strip → top and the remembered control per stop still returns.
- **The order of Back.** An open popover is its own level; Back closes it before
  Stop. The popover's scrim, outside-click and window-blur closes survive.
- **The 3-second auto-hide.** Any key, pointer move or wheel summons the OSD;
  keyboard/pad focus inside it and an open popover keep it up; a mouse click
  does not pin it. `useOsdVisibility` is untouched.
- **Pending.** An episode step still draws the wait, disables both steps and
  drops a second press (ADR-0027); the spinner is the kit's one spinner.
- **The seek preview rule.** One ask in flight, the newest bucket wins, the last
  still stays dimmed while the next is asked for, and no still is drawn as the
  time and chapter alone (ADR-0028).
- **The Snapshot, not a client copy.** Every selected track, chapter, speed,
  volume, prompt and crop is still the Host's answer; the OSD invents none.
- **Fullscreen on every screen.** The window control was already drawn on every
  browse surface by `WindowChrome`; on the Vite page it now uses the browser's
  own Fullscreen API as well, so the scoped prototype can be judged full-screen.
  Tauri still uses `setFullscreen`; the Tauri behaviour is unchanged.

## What is redrawn

- **The surface.** High-opacity glass and rounded pills are replaced by
  translucent ink (`color-mix(in srgb, var(--rep-ink) …%, transparent)`),
  gradients and 1px hairlines. `backdrop-filter` is removed: it cannot sample
  mpv's native child window (ADR-0003), and the repertory room does not use it.
- **The type.** Bodoni Moda for the Title and the popover headings; Inter for
  labels and body; IBM Plex Mono for the kicker, quality stamp, stats, volume,
  clocks, chapter callout and the fader. The old italic details line is gone.
- **The timeline.** Diamonds become brass ticks; the bar is a line inside a
  taller transparent band; the current chapter names itself in the middle; the
  elapsed/remaining clocks are mono and sit under the line.
- **The popovers.** A translucent ink plate with a brass top rule, a display-
  serif heading, mono group labels and hairline rows. A pressed row is marked by
  a brass inset rule instead of a rounded accent fill.
- **The volume.** From a glass pillar to a bare rail with a `Vol` label.
- **The focus and hover.** The room's 2px ivory keyline with a 3px offset; hover
  is a hairline and a faint ink lift; the brass top rule and the chapter tick are
  the only warm marks besides the progress fill.
- **The window control.** The browser's document fullscreen is now a fact this
  module follows, so a Vite window has the same control on Home, Discover,
  Search, Library, Addons, Settings, a Title, Streams, a dialog and the player.

## What is cut

- The rounded pills and their filled backgrounds; the title pill as a box.
- The glass (`--bg-glass-solid`), the blur, and the raised volume box.
- The chapter diamond glyph; the ticks are the mark now.
- The `Back` word beside the Stop X: the X is the control (the user's call on
  2026-10-29). The browse screens keep their printed `Back` word; this cut is
  the OSD's own control, not a change to Title/Streams/Settings.
- The old italic style on the stream details and the separate quality pill
  shape. The information is all still there, in the stamp and the ledger line.
- The Velvet OSD's vignette box; the repertory scrims are two ink gradients with
  one faint brass floor.

Nothing functional is cut. No test id, no Action, no focus rule and no
auto-hide rule was removed.

## Preview data, and what is not real

- The Vite window has no Host and no mpv. The Rehearsal bar's **Player → OSD**
  button (`data-testid="rehearse-player"`) publishes a rehearsal Snapshot built
  from the first real Cinemeta film in Continue watching: its name, artwork and
  runtime, with sample tracks, chapters, position and statistics. The picture
  hole shows that film's backdrop; it is a still, not a clip.
- The rehearsal is answered by the preview transport with the Host's existing
  Actions only: pause, seek, stop, volume, mute, speed, subtitle delay and
  scale, audio/subtitle track, chapter, crop, autocrop, aspect, preview. No new
  Action is invented. The clock ticks once a second while the sample plays so
  the timecode and playhead move.
- The Tauri window never shows the rehearsal backdrop or uses the preview
  transport; it plays the real mpv picture. HDR, hardware decode and the moving
  picture are Windows-only checks; the dev container has no GPU.
- No artwork, credential or clip is committed. The live Vite reads Cinemeta's
  public catalogue and Metahub's CDN.

## What is provisional for #150

These are the values and decisions #150 must lock, replace or confirm:

- **The scale.** Every `clamp()` in `repertory/osd.css` is measured for the dev
  window, not the panel: the Title size, the stamp, the details line, the
  clocks, the transport marks, the popover width and the timeline band height.
- **The opacities.** The top/bottom scrims, the badge fill, the popover plate,
  the preview plate and the fader gradient are prototype values. The Windows
  walkthrough is where "legible over a bright film" is judged.
- **The fader.** The vertical range still uses the browser's native track with
  `accent-color: brass`; a drawn rail with a brass fill is a #150 primitive, not
  a promise of this ticket.
- **The chapter line.** The current chapter in the middle of the timeline is a
  prototype reading; it may be too much at 4K or on a long title.
- **The tick density.** Six sample chapters are legible; a container with
  forty chapters is not answered by this prototype. A minimum spacing or a
  chapter rail is a #150 decision.
- **The popover shape and anchor.** The five panels are anchored above the strip
  by the old measured left/right; the repertory widths, the max height and the
  way a panel clears the top of the window at a short height are provisional.
- **The title source.** The top line prefers the Title name and the Video label
  from Watch progress, because `NowPlaying` is the Addon's own words. If a
  client has no progress entry (a Remote-started Stream, a fresh window), it
  falls back to the Addon's line; whether the OSD should ask for the Title name
  is a #150/#151 question about the Snapshot, not a change this ticket made.
- **The font packaging.** Fontsource package CSS today; the cutover ships lean
  Latin faces and the OFL notices. The OSD's Bodoni/Inter/Plex Mono names are the
  same pair the room already uses.
- **The browser fullscreen fallback.** It is prototype tooling for the Vite
  window. The shipped decision for the Tauri window is still `setFullscreen` and
  F11; whether the browser fallback stays after the cutover belongs to the
  window's staging decision (#152).
- **The rehearsal.** The sample tracks, chapters, statistics and the ticking
  clock are prototype scaffolding and leave with the flag. No sample belongs in
  the product.
- **The test migration rule.** The behaviour suite (611 tests on this branch)
  passes untouched; the repertory-specific drawing is covered by
  `src/shell/repertory/player.test.tsx` and the pure rehearsal by
  `preview.test.ts`. Which presentation assertions survive the cutover is #151.

## Verification

Inside the dev container:

- `pnpm typecheck`
- `pnpm test` — 50 files, 611 tests
- `pnpm build` and `VITE_UI=repertory pnpm build`
- `cargo test --workspace --no-fail-fast`
- `cargo clippy --all-targets -- -D warnings`
- `cargo fmt --check`

The window itself, with a real clip and the real mpv, is verified by the owner on
the Windows build. `verify.ps1` is not redesigned by this ticket; the dev
container cannot judge HDR or hardware decode.
