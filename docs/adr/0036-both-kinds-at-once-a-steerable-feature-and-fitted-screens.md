# Both kinds at once, a feature a person steers, and screens that fit

A round of use on the Windows build and the served Remote turned up four things
the repertory surface decided one way and the owner now wants the other. Each
contradicts something already written down, so this records what changes and
what it supersedes rather than letting the code drift from the docs.

## 1. Search and Discover show Movies and Series together

> **Amended by ADR-0043 for Discover.** Discover picks one kind at a time with a
> Type dropdown; Search still shows both kinds together.

The map's #146 decision narrowed the repertory Search and Discover to **one kind
at a time**, chosen with two single-select kind chips, Movie where a person
lands. That is withdrawn, in both clients (window and Remote).

- **Search** shows two rows under the query bar: Movies, then Series. Both kinds
  were already asked in flight (`RepertorySearch.tsx`), so this removes the
  chips, not an Action. The keyless arm (`search_catalogs`, one row per
  searchable Catalog) is unchanged.
- **Discover** shows one genre row, then two rows: Movies and Series. A genre
  chip filters **both** rows at once.
- Each row ends in the **More** card that opens the whole row as a grid, as every
  rail already does (design system, *Rail*). On the Remote, More opens that grid
  as a pushed Level; it no longer appends a page to the rail in place.

**Genres.** TMDB keeps two genre lists that are not the same set (`/genre/movie/list`,
`/genre/tv/list`; research note #48 §3.2). The one genre row is their union by
name, **All genres** first and then TMDB's film order with the series-only names
after it. A name TMDB folds into a combined series genre asks the combined one
for Series — Action and Adventure ask *Action & Adventure*, Science Fiction and
Fantasy ask *Sci-Fi & Fantasy*, War asks *War & Politics* — so a combined series
genre is reached through its film parts and is not a chip of its own. A genre with no counterpart in a kind
leaves that kind's row empty with a line saying so, rather than hiding the row.
The mapping is a pure decision in `src/core/discover.ts` and is tested there.
It is still TMDB's own vocabulary, not a curated second list.

## 2. The Feature is steered, and shows its time

> **Amended by ADR-0043.** The hero carries Watch now and Details, and in the
> window it follows focus once focus moves down into the rows.

The Feature (the Home hero, drawn from the Featured catalog) rotated on a timer
only, with Left/Right on the window. Both clients now:

- step it with **Left/Right** (arrow keys, D-pad) and with a **horizontal drag
  or swipe**;
- draw **one tick per item** of the programme, the current one filling over the
  item's time on screen — the elapsed time is the progress, the rest is what is
  left;
- jump to an item when its tick is **clicked or tapped**;
- **pause** the fill while held — focus on the window, a finger down on the
  Remote — as focus already held the window's rotation;
- **restart** the current item's time on any interaction: a step, a drag, a tick.

(Amended 2026-11-06, sprint 248: the hold is a *person's* — a focus move of
their own, a finger — not the focus the screen seats on the feature when Home
mounts, so the beat starts on launch (#250, #248). A swipe now follows the
finger and commits past a share of the frame or on a flick, snapping back
otherwise; the Remote's hero also carries previous/next arrows that step and
wrap. `docs/design-system.md` *Feature* is amended to match.)

**Reduced motion no longer stops the rotation.** This supersedes the line in the
design system (*Feature*: "reduced motion stops it") and is a deliberate
exception to ADR-0031 §5 for this one component, at the owner's request. What
reduced motion still removes is *movement*: the slide change is a fade, not a
slide, and the tick fill is the only thing that animates. ADR-0031 §5 stands for
every other component.

## 3. Some screens fit the window and never scroll vertically

The design system's *Page* rule let a short window scroll the page rather than
clip the copy. For these screens the page itself **never scrolls vertically**;
it fits the window (or the phone's viewport), and anything longer scrolls
**inside its own panel** or pages horizontally:

- **Discover** and **Search** — the head, the chips and two rows fit.
- **Title** — the window's episode list scrolls inside its panel; on the Remote
  the whole Title body scrolls under the fixed Back (amended 2026-11-07, below);
  the page does not.
- **The Remote's player screen** (the Cast Remote) — every control fits.

Home and the utility register (Addons, Settings, Library) keep the old rule: a
programme of many rows still scrolls.

(Amended 2026-11-06, sprint 248, PR #263, the owner's decision after the Windows
look.) On a fitted feed a readable poster wins over fitting. A card is sized
from a floor of 180px of art height — about 120px wide at 2:3 — and the title
caption under it is counted at its real height, so it is never clipped. On a
short page (below 900px of fitted height) the screen's own chrome turns compact:
a smaller programme line, a tighter one-line genre row and a slimmer TMDB
credit, whose words and mark stay. Where both rails still cannot hold the floor, the **rows
panel** scrolls under the fixed screen head, genre row or search bar — the page
itself still never scrolls. A reveal into a rail keeps that rail's head in
view with the card. Discover and Search share the same two-row rule.

(Amended 2026-11-07, the owner's report: on a phone the Remote's Title showed
only a sliver of the seasons row and no episode list, and nothing scrolled.) A
phone cannot hold the copy — the name or logo, the facts, up to eight lines of
description and the attribution — and the episode list side by side, so on the
**Remote** the Title body is the one scrollport: the copy, the seasons, the
episodes and **Find Streams** scroll together under the fixed Back and the
bottom index, and the episode list is normal flow rather than a nested scroll.
The seasons row never shrinks vertically and still slides sideways. Find Streams
and every episode are reachable by scrolling, for a series and for a film with a
long description and a logo. The **window's** Title is unchanged: it keeps the
fitted two-column page with the episode list as its panel. The two answers are
the page seam's (`pageFit` and `pageSurface`), not a CSS accident.

## 4. The Remote's playing bar steps aside on the player screen

> **Amended by ADR-0043.** The remote the strip opens fills the phone's screen,
> without the tab bar.

The floating *now playing* bar the Remote shows over every screen is hidden while
the player screen itself is open; it points at the screen a person is already on.

## 5. Whole-row grids read past their first page

(Amended 2026-11-06, sprint 248.) The design system's *Rail* said a whole-row
grid opens the cards read so far and asks no page of its own. The owner's
by-hand test reversed that: a row reads 20 per page, so the grid stopped at 20
unless the rail's **Read on** had been pressed first. A grid now reads on by
itself — when the person scrolls or moves focus near its end it asks that row's
next page into the same accumulated row the rail draws — until the row is done.
Back therefore keeps the cards the grid read, and a page read on the rail is in
the grid. A page that fails keeps the cards it had and offers Try again, and the
rail keeps its quiet **Read on** head action (#264).

On the Remote, Discover's and Search's rows, genre, query and pages now live in
the Session rather than in the screen, so a pushed Title or grid no longer takes
them away; that also closes #262. The design system's *Rail* entry is amended to
match.

## Rejected, with reasons

- *Keeping the kind chips and adding a "Both" chip* — three states for what the
  owner wants as one, and the chip still costs a press to see the other kind.
- *One genre row per kind* — two filters for one question; the union reads as
  one choice.
- *Fitting Home by staging one row at a time* — offered and declined: Home keeps
  its scrolling programme.
- *Honouring reduced motion by stopping the Feature* — the previous rule; the
  owner prefers the programme to keep moving, and the movement itself is still
  removed.

## Consequences

The design system's *Page*, *Rail*, *Feature* and *Chip* entries are amended to
match. Window tests assert the decisions (ADR-0032): the genre mapping, the
Feature's step/restart/pause decisions, which screens are fitted. A fitted
screen is verified at the walkthrough's window size on Windows and at a phone
viewport for the Remote.
