# Specials come last, and stand apart

A series' list of Videos, as TMDB and most Addons give it, puts season 0 (the
specials) first. ADR-0021 made that list's own order the order `next_episode`
and `previous_episode` step through, so the order crossed every boundary the
list had. Continue watching's **Up next** is a third reader of the same order,
and specials-first gives it the wrong answers: "next" after the last special is
S1E1, and a viewer who never touches the specials still sees them first on the
Title screen. This records the order the Host uses now, and the one boundary it
will not step across.

## 1. The order: numbered seasons ascending, then the specials

A series' Videos are ordered by numbered season ascending, then by episode within
each season, then by the specials in their own order. The Title screen draws its
season chips in that order, so **Specials** is the last chip. On a series with no
specials nothing changes.

## 2. Stepping never crosses between the numbered seasons and the specials

`next_episode`, `previous_episode` and Up next all walk the order above, and none
of them crosses the line between the numbered seasons and the specials:

- a season's finale steps into the next season's first episode, as before;
- the series' **last numbered episode** has no next. `next_episode` is refused with
  `no_next_episode`, and Continue watching has no Up next, so the series leaves
  the row;
- inside the specials, next and previous step from special to special. The last
  special has no next, and the first special has no previous.

The specials are entered only by pressing one.

## 3. ADR-0021 is revised, not left contradicted

ADR-0021 §1 says "the order is the Addon's whole list, so it crosses season
boundaries — the list is what defines order". The list still defines the order
*within* a season and *between* numbered seasons. It no longer decides where the
specials go, or whether a step reaches them. The other rules of ADR-0021 stand:
no id arithmetic, the neighbour plays from the Addon already playing with the
same `bingeGroup`, and a refusal moves nothing.

Rejected, with reasons: **the list's own order** (it puts specials ahead of the
pilot and makes "next" after the last special the pilot); **Up next skipping
specials while `next_episode` keeps the list order** (the OSD's Next Ep and the
card would disagree about what comes next); **finale → first special** (a viewer
binge-watching the numbered seasons would be dropped into extras they did not
choose).
