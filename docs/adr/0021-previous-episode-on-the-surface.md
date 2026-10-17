# Previous episode on the surface: the Action, the reading, and the revision of ADR-0018 §4

Ticket #65 ("The previous_episode seam") is where the cast remote's `Prev Ep` and
the ten-foot OSD's transport meet a gap: the Action surface has `NextEpisode` and
no `PreviousEpisode`, and ADR-0018 §4 says so deliberately — an earlier episode is
"a press on that episode" in the Title's own list. The owner has since decided that
both surfaces want a `Prev Ep` beside `Next Ep`, which overturns §4. This records
the Action, the reading, and the one place the earlier prediction was wrong.

## 1. `previous_episode` is the mirror of `next_episode`

`Action::PreviousEpisode` carries no payload and spells `previous_episode`. It joins
`Action::SPELLINGS`, so the companion's capability list grows by one and
`the_remote_declares_the_whole_action_surface` stays green by construction
(ADR-0018 §2). It is refused the way next episode is:

- `Control::PreviousEpisode` names it where nothing is playing to step;
- `ActionError::NoPreviousEpisode { detail }` spells `no_previous_episode`, the twin
  of `no_next_episode`.

What "the previous episode" *means* is the same rule as "the next", mirrored: the
first Addon that answers `meta` for the Title and still lists the Video playing is
asked for its list, and the Video *before* it in that Addon's own order is the one.
The order is the Addon's whole list, so it crosses season boundaries — the list is
what defines order, and a season boundary would be arithmetic the Addon never
stated. The earlier Video plays from the **Addon already playing** and the **same
`bingeGroup`**, falling back to that Addon's first playable candidate, because
continuing the release is continuity and not a score (ADR-0012, ADR-0014).

The boundaries:

- a **film** — an id that is not an episode's shape, the reading `episode_of`
  already makes — is refused, exactly as it is for next;
- at the series' **first listed episode** the Action is refused with
  `no_previous_episode`, and the Stream keeps playing: a refusal moves nothing.
- Watch progress records the earlier Video as its own entry and the one just
  watched stays (ADR-0015, #29).

Rejected, with reasons: **incrementing the id's last component** (it invents an
episode the Addon may not have, and ADR-0014 forbids it for next already);
**the client computing the previous Video and playing it** (it is an Action, the one
surface both clients share); **stopping at the season boundary** (a rule the Addon
does not state, and a divergence from next's whole-list order); **re-ranking the
candidates** (ADR-0012's scoring engine, which continuing a release is not).

## 2. No new Telling: it is a `Change::Play`

`next_episode` adds no vocabulary above the Player seam — it is a `Change::Play`
that re-asks the Addons and reopens the Stream (ADR-0014). `previous_episode` is its
mirror in that too: mpv is asked to `open` another URL, and nothing new is asked of
the Player. The Action version stays 1: a variant added to a flat enum is additive,
as every control before it was.

ADR-0018 §4 predicted "an `Action`, a `Telling` and a property in the reading". The
shape is kept — an Action and a property — but the middle term is dropped: there is
no Telling, because stepping to another episode is opening a Stream, not controlling
the one playing.

Rejected, with reasons: **a Telling** (a chapter-like step would put a Host rule —
what plays before this — below the seam, where ADR-0013 keeps the Host's rules).

## 3. The reading publishes the episode's position, not its neighbours

`PlaybackSnapshot` gains `episode: Option<Episode>` — `{"season": 1, "episode": 2}`,
and null for a film. It is the Host's own reading of the playing Video's id,
`meta::episode_of`, the same read `next_episode` refuses against; it sits on the
Snapshot beside `position` and `crop`, **not** inside `NowPlaying`, which is
documented as the Addon's own words about the candidate and knows nothing of the
protocol's id shape.

It deliberately does **not** publish `hasPreviousEpisode` / `hasNextEpisode`. The
playback session holds the chosen Stream's words and the Title's *stub* — never the
Title's Video list, which only ever exists in a per-client `open_title` Answer
(ADR-0005). A truthful "a neighbour exists" would therefore cost a `meta` fetch every
time a Stream opens, with a TMDB path too when a key is held (ADR-0020), and it would
publish a live Addon question as shared state that can go stale. Whether a neighbour
exists stays the Host's answer, delivered by the refusal on the press — which is what
`controls.ts` already argued about `next_episode`.

What the field *does* buy: both clients currently guess with
`playing.video.type === "series"`, a reading of an id shape the Host owns. The
`episode` field replaces that guess with the Host's verdict, so one rule does not
live in two codebases (ADR-0002) — while the truth of existence stays on the one
surface.

Rejected, with reasons: **`hasPreviousEpisode` / `hasNextEpisode`** (the `meta` fetch
or the stale shared browse above); **publishing nothing** (the `type === "series"`
guess stays duplicated, and the design's greyed S1E1 has no signal); **the tagged
form `{ kind: "episode" } | { kind: "film" }`** (a tagged enum is for a real second
alternative; a film is simply the absence, as it is for every other optional fact on
the Snapshot).

## 4. The clients grey the controls, and the press answers

Both clients share one disable rule:

- **Prev** is greyed when `episode` is null (a film) or `season == 1 && episode == 1`;
- **Next** is greyed only when `episode` is null (a film).

Beyond that the controls are live. An episode that turns out to have no neighbour —
the Addon's list ends, or begins at it — returns `no_previous_episode` /
`no_next_episode`, shown where the refusal is raised. A numbered "S1E1" can be wrong
for a season that starts at specials (the ordering hazard ADR-0020 recorded), and
there the press is what corrects it — which is why the field is a position and not a
verdict.

## 5. ADR-0018 §4 is revised, not left contradicted

This ADR supersedes ADR-0018 §4, and §4 carries a pointer note to it rather than
standing contradicted (AGENTS.md). No `CONTEXT.md` change: `next_episode` carries no
glossary entry, and "a single episode" already lives inside **Video**'s.

## Consequences

- A new Action grows the surface by one: an `Action` variant, a `ValidatedAction`
  variant, a `Control`, an `ActionError`, the spelling list, and the companion's
  capability list (ADR-0018 §2 is a comparison of two lists and stays green).
- Both clients replace `hasNextEpisode`'s `type === "series"` with the `episode`
  reading. The transport's `Prev Ep` on the window's OSD is the OSD ticket's (#57,
  unblocked by this decision); the companion's is its own build.
- The `PlaybackState::Ended` gap surfaced while deciding — a state never produced,
  and a window `Next` button drawn for it — is a Host matter, not a client one, and
  is left to a standalone issue rather than decided here.
