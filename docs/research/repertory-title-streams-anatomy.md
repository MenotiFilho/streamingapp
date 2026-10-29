# Repertory Title, Streams, Discover, and Search anatomy

**Ticket:** #146 (wayfinder map #143). **Branch:** `prototype/146-repertory-title-streams-discover-search`, over the repertory frame and Home from #145. **Run:** 2026-10-29.

This is the prototype's record, not an ADR: the frame, the Home anatomy and the
type pairing are already decided on #145 (`spine`, Bodoni Moda / Inter / IBM Plex
Mono, rotating feature). What follows is how the remaining browse screens wear
that direction, what the technical list must keep, and what is still open.

## Title: one screen, two columns

The Title is a **programme page**, and the whole page is the backdrop:

- The backdrop stays the page. A scrim darkens it from the left and from the
  bottom; the picture is never replaced by a flat panel.
- Left: the wordmark (`logo`) or the name in the display serif, the facts
  (`IMDb`, year, runtime, genres), the description, and the attribution. An
  Unmapped Title carries its brass stamp here: *Unmapped — no TMDB record met
  this Title, so it is keyed by its Addon.* The stamp is a mark, not an error;
  red stays status-only.
- Right: the next action. A film gets one large **Find Streams** control. A
  series gets a season index as single-select **chips in one horizontal rail**
  (the rail scrolls sideways; a season never wraps onto a second line), then its
  episode rows with their 16:9 stills, `S#E#`, name and a **Streams** mark. The
  episode list is the vertical scroll inside the rail. Choosing an episode
  pushes the Streams level; Back returns to this page with that episode still
  chosen.
- The page is sized to one screen. The episode rail takes the height that is
  left after the season rail; the left copy is fixed. A short desk window falls
  back to a scrolling page rather than clipping the copy.
- Facts and description are on the left, not below the fold; the old
  below-hero body is gone. The Title's own top line carries only **Back** — the
  programme line ("The programme / A series") is not part of the Title page.

## The technical list

The Streams level is a **screening list**, not a poster wall. What it must keep:

- **One group per Addon**, in the Host's order, with the Addon's display name and
  its candidate count. An Addon that failed or answered nothing says so in its
  own group without blanking the others.
- **Every candidate**, including one this Host cannot play. A candidate is never
  hidden for being unplayable; the list is what exists.
- The Addon's own **badge lines verbatim**, split on its line breaks. The first
  line reads as the source, the rest as quality/source marks (`4k HDR`,
  `Blu-ray`, `WEB-DL`, and so on). Nothing is re-worded or re-ranked.
- The Addon's **description**, its **filename** in mono, its **warnings**
  (`notWebReady`, `p2p`, `proxyHeaders`) in the Host's vocabulary, and the
  **unplayable reason** beside the candidate. An unplayable row is marked with
  red and keeps the full filename and badges.
- **Pending**: a candidate being opened says so; a second press while the Host
  answers is dropped (ADR-0027). Back from Streams returns to the Title and its
  chosen episode.

The prototype's plain Vite window reads real Torrentio candidates for the
Title's Streams. They are torrents, so every one is marked unplayable by this
Host — that is the mark the list exists to show, not a preview failure. The
Tauri window asks the real Host.

## Discover and Search: editorial feeds

Both destinations use the same poster/caption anatomy as Home:

- The poster is unframed, 2:3, with the IMDb stamp over the art at bottom-right.
- The title is the only running text; the year is a smaller stamp beside it.
- A Title no configured Addon could play keeps an **Unplayable** stamp and still
  opens (ADR-0020). A feed does not hide it.
- Discover and Search use **two single-select chips for Movie and Series**:
  Movie is selected on landing, choosing Series deselects Movie. Discover adds
  a single-select genre chip row, with **All genres** first. The real Discover
  already had this shape; the prototype extends it to the preview feed and to
  Search's repertory surface. Search still asks both kinds, so switching chips
  is instant; the Velvet surface keeps its two rows.
- The large screen heading and the explanatory lede are removed on the
  repertory surface. The head is one programme line: the destination name in
  brass on the left, then the rule. The feed is the page.
- Search keeps its submit-only query bar, its submit-only reasoning, and its
  per-row failure. The bar is drawn as a display-serif line over the ink, with
  the submit control at its trailing end.
- Discover's TMDB credit and the no-key state stay. With no key the screen says
  what powers it and where the key goes (ADR-0020); it does not disappear.

## Preview data, and what is not real

- Artwork and metadata are live: Cinemeta's Popular catalogues, poster and
  backdrop URLs on Metahub, and the Addon's own ratings and years. No artwork or
  credential is committed.
- In the plain Vite window there is no Host and no TMDB key, so Discover's
  preview feed uses Cinemeta's Popular catalogue as a stand-in for TMDB's week.
  The Tauri window uses the real `discover` Action and the Host's credential.
- The preview transport answers `browse_catalog`, `open_title`,
  `search_catalogs` and `find_streams`; it never invents an Action the Host does
  not have. The Real Host remains the only source in the Tauri window.

## Still provisional

- The feature's artwork treatment and crop; the 4K layout paddings (still the
  #145 open item).
- The Title hero's exact height and the episode rail's visible row count at
  1920; the current values are measured for the dev window, not the panel.
- The genre chip order and whether the full Cinemeta list belongs on the
  repertory Discover surface, or only the common genres.
- The precise treatment of a long description (line clamp today) and a Title
  with no backdrop.
- The font packaging (Fontsource package CSS today; the cutover ships lean Latin
  faces and the OFL notices).
- The OSD, the served Remote, and the test migration rule are untouched by
  #146.

## Verification

`pnpm typecheck`, `pnpm test`, `pnpm build`, `cargo test --workspace
--no-fail-fast`, `cargo clippy --all-targets -- -D warnings`, and `cargo fmt
--check`, inside the dev container. The window itself is verified by the owner;
`verify.ps1` is not redesigned by this ticket.
