# The Marquee design system supersedes Repertory

On 2026-11-27 the owner asked to redo the client's design from scratch, closer to
the commercial streaming apps and to Nuvio. The mockup was drawn as a component
library first and every screen after it, in window and phone pairs, and the owner
reviewed it screen by screen and approved it. This records the replacement and the
choices made along the way; the values live in `docs/design-system.md`, and the
drawing lives in `docs/design/marquee/`.

It supersedes ADR-0030 whole. It amends ADR-0036 §1 (Discover only), §2 and §4,
as set out below. ADR-0031 stands: Motion is still the animation layer and its
presets still apply, but what moves under them changes (`docs/design-system.md`
§6).

## 1. One client language, and it is Marquee

The client's visual language is **Marquee**: a near-black canvas, the Figtree
family, artwork-led screens (full backdrops behind a hero and a Title, posters and
16:9 cards with rounded corners), glass panels with a background blur, pill
controls, and two roles for colour. **White is focus**: whatever has it turns
white with ink content, and a card scales up with a white outline. **Lavender,
`#C4A7E7`, is the primary action at rest, progress and selection.** It replaces
Repertory's ink-and-ivory printed programme: the display serif, the mono
bookkeeping, hairlines instead of cards, the single brass house colour, the
ivory keyline and the spotlight wash.

Repertory is not a base to inherit from, for the same reasons ADR-0030 gave
about Velvet Curtains. Marquee adopts exactly what Repertory refused (rounded
cards and pills, glass and blur, shadows for depth, a card that scales on focus,
fill inversion on focus), so no `--rep-*` token is carried over as an alias, no
Repertory face ships, and the cutover deletes the Repertory sheet. The two
coexist only on the integration branch where Marquee is built
(`integration/marquee`); `main` stays Repertory until that branch merges whole,
after the owner's walkthrough of the Windows build.

Rejected, with reasons: **restyling Repertory screen by screen** (its refusals are
the direction itself; a screen can't keep hairlines and add glass, and `main`
would speak two languages for the length of the work); **keeping both behind a
setting** (ADR-0030's reason still holds: two languages for one room, and a second
palette to keep measured).

## 2. The record, the values and the drawing

`docs/design-system.md` is rewritten as Marquee's living record, in the same
place and with the same role as before. The values move to `--mq-*` tokens in one
sheet. The mockup is drawn by a script, `docs/design/marquee/scripts/build.js`:
the component library (pages Foundations and Components) and every screen,
composed from it (page Screens). The `.fig` it writes, its previews and the
artwork it draws are generated, not committed. The artwork is third-party
(Cinemeta and metahub), and `scripts/fetch-assets.sh` downloads it from a pinned
list of titles. A change to the record and a change to the drawing land
together.

Icons are **Phosphor** (MIT), regular weight for chrome and fill for transport and
active marks. They replace the hand-drawn set of ADR-0030. Figtree (OFL) ships as
local `woff2` faces that the Host serves, as Repertory's faces did; no page fetches
a font or an icon from a third party.

## 3. Navigation and the hero

- **The window's navigation is a side rail.** It shows icons only while focus is
  in the content, and widens with labels when focus enters it, dimming the screen
  behind it. Active is lavender, focus is white.
- **The Home hero rotates, then follows focus.** It turns through the featured
  titles with focus on **Watch now**, beside **Details**. When focus moves down
  into the rows it switches to *following focus*: it shows the focused card's
  title, moves its backdrop to the right, and the rows slide up under it; going
  back up returns to rotating. This amends ADR-0036 §2, where the whole frame
  opened the Title and nothing followed focus. Ticks, swipe and hold still steer
  it. On the phone it only rotates and swipes, because there is no focus to
  follow.
- **The phone** keeps the six destinations as a bottom tab bar. It keeps the
  now-playing strip above it, which shows the Title's poster. The remote that the
  strip opens fills the screen, without the tab bar, and shows the Title's poster
  rather than a frame. This amends ADR-0036 §4's dock.

## 4. What the drawing asks beyond today's client

The owner chose each of these knowingly, against what `main` does. None is
decided here as behaviour. Each lands as its own ticket, reasoned against
`CONTEXT.md` and the ADRs it touches, and some need the Host.

- **Title:** a **Choose stream** control beside Resume or Play for series (films
  already offer Find Streams); each episode shows its own description (which
  `Video` does not carry today).
- **Streams picker:** a filter by Addon; **Try again** on an Addon that failed.
- **Player:**
  - a **Streams** menu, which switches the Stream while playing and keeps the
    place (the **Episodes** menu beside it exists already and is redrawn);
  - a **Details** menu holding the Torrent status and the Statistics, which leave
    Picture;
  - subtitles and audio in one panel on the window (the Remote already pairs
    them), with sync (±0.1 s) and a subtitle size from **25% to 300% in 5%
    steps** (the Host clamps 50%–200% today);
  - while a Stream opens, the Title's logo fills in, or its name over a bar when
    it has no logo; a spinner only while it is Stalled;
  - the window's transport drawn without previous episode and Stop, and the next
    episode as a labelled button.
- **Discover:** one grid with **Type**, **Genre** and **Sort** dropdowns. Type
  picks one kind at a time, which withdraws ADR-0036 §1 for Discover only;
  Search still shows Movies and Series together. Sort is new to the clients (the
  `discover` Action already accepts `sort`).
- **Library:** an All / Movies / Series filter.
- **Search:** the Addons' searchable Catalogs and TMDB at once, a row for each.
- **Addons:** an **enable/disable switch** per Addon, which is new Host state.
  Details, reorder (`reorder_addon`) and remove with a confirmation exist already
  and are re-drawn: move up and move down, a moving state, and Edit mode on the
  phone.
- **Settings:** Preferences split into a list where each part opens its own
  level, with Autoplay inline as a switch (today Preferences is one flat screen,
  though Autoplay itself already exists).

Rejected: **deciding these here** (each is behaviour, and a design record must not
move an Action, a Snapshot or a Host rule by drawing it).
