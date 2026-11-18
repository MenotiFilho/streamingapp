# The Host chooses the Track

Spec #304, ticket #322 (the prefactor; the behaviour lands in the tickets after
it). Research: `docs/research/mpv-language-track-selection-288.md` (#288).

Until now the Host held **one** subtitle language and handed it to mpv as
`slang` (ADR-0014): mpv matched, and an embedded Track always won over an Addon
subtitle. The owner now wants **two ordered lists**, Subtitle languages and Audio
languages, each of up to three languages with a fallback order. That cannot be
delivered by handing mpv the lists, so the decision moves: **the Host chooses the
Track, by Track id.**

## 1. The Host ranks, mpv is given the lists only as a first guess

The Host ranks the Tracks the Player reports, plus the Addon subtitles it asks
for, against **Subtitle languages**, **Audio languages** and the **Hand pick**,
and selects by Track id. The soundtrack is chosen first, then the subtitle. mpv
still receives the lists as `slang` / `alang`, expanded through the Host's code
table, so the first frame is usually already right, but its answer is not the
decision: the Host tells where it differs from what mpv selected.

## 2. What this reverses in ADR-0014

- **"mpv does the matching"** (the language preference is `slang`; the Host does
  not match languages).
- **"Embedded Tracks always win."** An Addon subtitle in a listed language now
  beats an embedded one in a later language. An embedded Track still beats an
  Addon subtitle of the *same* language.

The Addon subtitles fallback's request and its cap stand where this ADR does not
change them.

## 3. Why mpv's own choice is not enough

Facts from the research note, each verified against mpv 0.41 source:

- `pt-BR` **ties** a bare `pt`/`por` track at the top score, so container order or
  the default flag decides between them, not the region the owner asked for.
- `pob`, what Addons send for Brazilian Portuguese, is **unknown** to mpv's
  language table and scores 0 against `pt-BR`.
- `hearing-impaired` is **never read** during selection: regular and SDH Tracks
  of one language are told apart only by container order.
- `sid=no` **sticks** across Streams (it is below zero, so mpv never resets it
  when the next file's layout differs), and `subs-match-os-language` picks by the
  OS language when `slang` is empty.
- `sub-add <url> auto` **never selects** the track it adds, and a `slang` or
  `alang` changed mid-file never re-selects: the Addon fallback only "worked"
  when the owner opened the menu and picked a subtitle by hand.

## 4. What a Track says of its language, and what a Hand pick keeps

A Track's language is its tag's, read through the Host's code table. A title
only fills what the tag leaves open (a region, and the SDH, forced and
commentary flags): a Track with no language tag matches no list entry and
records no Hand pick, whatever its title says.

A Hand pick records the curated entry the picked Track's tag falls under (`fr-CA`
and `fre` are `fr`, `es-MX` is `es-419`), so the next Stream's Track, which spells
the same language another way, answers it. A curated regional entry keeps its
region, and a tag with no curated entry is kept as the file wrote it, which is
the only way it can match again.

## 5. Rejected alternatives

- **Hand mpv the list and accept its choice.** Every gap above stays, and the
  owner's order across languages (an Addon `pt-BR` before an embedded English)
  is not something mpv can express.
- **A client-side choice.** Two clients would disagree about the same Stream, and
  the Host is the one place a decision is made so that every client shows the same
  thing (ADR-0002).

## Consequences

`SubtitleLanguage` becomes `Language`, the vocabulary of both lists, and the
curated list a client offers (`src/languages.json`) is shared by both. A tag that
is not on the list is still a language. The refusal for a bad tag is
`invalid_language`, whichever list it was for. An empty list is called **Follow
the file**: the file's own default Track, with no choosing by language.
