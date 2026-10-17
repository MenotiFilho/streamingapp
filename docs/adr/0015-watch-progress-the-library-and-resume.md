# Watch progress, the library, and resume: written while it plays, and a card the client hands back

> **Terminology note (#55).** This ADR predates the Library / Continue watching
> split: where it says "the library" it means the Host's Watch progress — the row
> `CONTEXT.md` now calls **Continue watching**. **Library** today means the
> Stremio-account collection, which is not built.

> **Amended (#62).** The card carries one field more: the Title's `background`.
> The **Continue watching** row draws `16:9` art (the component kit, #50), and the
> poster the card already carried is portrait, so the backdrop rides the same
> client-supplied `TitleCard` and reaches the Snapshot's `watchProgress` beside it.

Ticket #29 ("Watch progress, the library, and resume") is where the Host starts
remembering something between runs. Eleven decisions are worth writing down; the
rest is mechanical once they are made. ADR-0013 predicted the shape — "#29
records Watch progress from the position the Host already publishes, and uses the
`ended` state it can now see" — and this is that prediction kept, with one place
where it needed a little more than predicted: a resume begins where a Stream was
left, and *where a Stream starts* had not been a thing the Player could be told.

## Watch progress is written *while* it plays, not on the way out

The ticket's first acceptance criterion is "position is recorded during playback
and survives a restart and an unclean exit", and the second clause is the sharp
one: a Host that wrote only on `StopPlayback` would lose everything the moment it
was killed. So the write happens on the sampling tick that already happens.

`Host::sample` folds the Player's report into the session (ADR-0013), and — when
the report is worth writing — folds the same position into the Watch progress for
the Video playing and hands one entry to the store. "Worth writing" is
[`PROGRESS_EVERY`](../../crates/host-core/src/progress.rs): 5 seconds of movement,
or the Video finishing, or the duration arriving for the first time. The Player
is sampled four times a second and the store is **not** written four times a
second; a position the Host publishes to a client is not the same thing as a
position it commits to disk.

A change a *client* made is written at once, whatever the position did: `SetPaused`,
`Seek` and `Stop` force the write, because that is the last thing the Host was
*told* and what an unclean exit keeps. `Stop` writes before it lets the session
go, because after the stop there is no position left to read.

Rejected, with reasons: **writing on a clean stop only** (an unclean exit loses
everything, which is the criterion); **writing every tick** (a database ground
down by its own player, for a resume point no finer than five seconds needs);
**keeping the library out of state and reading the store per Action** (a resume
and a next episode would each be a query, and host-core holds state, not queries);
**a background writer thread** (host-core has no threads and no timers, and the
sampling tick already carries the work — ADR-0013).

## The Host holds no clock, so the clock is a seam

A progress entry is stamped with the moment it was written. That stamp orders the
Continue watching row now, and it is what #30's merge resolves two writes by
later, which makes it the Host's own record rather than a thing to invent per
caller.

So there is a [`Clock`](../../crates/host-core/src/clock.rs): one method,
`now_millis`, implemented by `SystemClock` for the real Host and `FixtureClock`
for tests. It is handed to `Host::new` beside the Player, for the same reason the
Player is: it is a fact about the machine, not a decision of the Host's, and
`host-core` holds neither threads nor timers (ADR-0013). "Most recently played"
is then a fact a test decides rather than one about how long two statements took.

Rejected, with reasons: **`SystemTime::now()` inside the Host** (the cache does
read a clock directly, but the cache is not published and not ordered by it —
here a test that played two Videos in the same millisecond would be a test that
sometimes passes); **a `now` argument on `dispatch` and `sample`** (two signatures
wider, and every caller of both made to carry a clock it does not own);
**ordering by insertion** (a Video rewatched would keep the place it first took,
which is not "most recently played").

## The library travels as a Snapshot, and it is not a question

The spec names the library beside playback — "**Snapshot**: the Host's periodic
state message … carrying now-playing and library state" — and it is the same kind
of state: every client is owed it, and a client reading its own library is
looking at what every other client sees. So it is a field of `Snapshot`
(`watchProgress`), not an `Answer`.

That is the deliberate difference from ADR-0010's catalogs, and the reason is
ADR-0005: a catalog row is what one client is browsing, and two clients browsing
differently is the point; the library is what the owner has *watched*, and there
is one of those. A client's scrolling is still its own.

Rejected, with reasons: **the library as an `Answer`** (a client would have to
ask, and a second client would have to ask again — the shared state the Snapshot
is for); **the library in the store only, read on demand** (no client could draw
the row without a question, and the row is exactly what a Snapshot is for);
**sending only the partly-watched entries** (what is partly watched is a reading
of the entries — a fraction, a watched bit — and a Host that filtered would be
deciding a client's presentation: the window draws every entry, with a watched one
marked and a finished one still there to be played again).

## The Title a Video belongs to is the client's, so the client hands it back

A library card needs the Title's name and poster. The Host does not have them:
opening a Title is a client's own business (ADR-0005), a Title's meta is not
cached, and the Addon a Stream came from is not necessarily the Addon that would
answer `meta` — AIOStreams streams, Cinemeta describes. Two ways to get the card
were possible, and one is wrong.

The Host *could* have asked the configured Addons for the Title's meta when a
Stream was chosen, the way `NextEpisode` already does. It would put a network
round trip in front of every play, and — worse — it would make the library depend
on the network at the moment of playing. The spec's own story is "the library is
a real store the Host owns … so that it works with no account and no network",
and `PlayStream` is a change, not a question: it does no fetching today.

So `Action::PlayStream` gains `title`: the Addon the client opened the Title
from, and the id, type, name and poster it was reading. It is the same shape as
the candidate beside it — the client has it, the Host re-asks nothing — and it is
what makes recording progress work offline. The client's words are bounded the
way every Addon's are (`TitleStub::parse`): a name too long to hold falls back to
the id, a poster that is not one is dropped, and a Title whose type or id is not
one a request could name is refused before anything is stored.

The field is required rather than optional, and `ACTION_VERSION` stays 1: the
version is the envelope's, and a field that only a client *older than this one*
would omit is a client that does not exist — the window ships with the Host, and
the remote client is #31. The version moves when a client that predates the field
does. A `PlayStream` with no Title behind it (the `Option` the change itself
carries) is still played, and simply not recorded, which is what a next episode
whose Title the Host was never told gets.

Rejected, with reasons: **fetching the Title's meta at `PlayStream`** (a network
round trip in front of every play, and a library that degrades when the network
does); **opening a Title silently recording the library** (a question that mutates
shared state and moves the revision is the "second path" ADR-0002 exists to
prevent, and it would put every Title anybody *looked at* into everyone's
library); **keying the entry by the Addon a Stream came from** (a state rather
than a Title's identity, and it would lose the card and the unplayable rule the
acceptance criteria are written against).

## Finished is the end or the last thirty seconds of it

A Video counts as watched when playback reaches its end, or when it stops within
[`FINISHED_TAIL`](../../crates/host-core/src/progress.rs) — thirty seconds — of
it. A person who stops in the credits has watched the thing, and an entry left
"partly watched" at 99.8% would offer a resume point two seconds from the end.
The `ended` state is not required for this: the position and the duration answer
it, which is also what makes a Stream killed at the credits count.

The tail is a named constant with a boundary test rather than a number in an
expression, so the rule has one place if it ever needs a second opinion.

Rejected: **only `ended` counts** (killed at the credits is finished by any
account); **a fraction such as 90%** (for a forty-seven-minute episode that is
four minutes early, which is a resume point, not an ending).

## An entry is keyed by the Video, and a series' episodes are separate entries

Watch progress is recorded against a **Video** — the unit the glossary and the
spec both name for it — so the store is one entry per Video, and two episodes of
one series are two entries with two positions. Nothing merges them: "watching
episode 4 does not overwrite episode 3" is a consequence of the key, not a rule
anybody had to write.

`NextEpisode` is where this shows: it opens the next Video and the change creates
the *next* Video's entry, carrying the Title that is playing's card forward (the
Host was told it when the Stream started). The episode that finished keeps its
entry, marked watched.

Rejected: **one entry per Title with an episode cursor** (would overwrite a
series' episodes, which is the criterion); **progress keyed by the Title id with
the episode in a field** (the same thing with more places to look).

## The library is a mark, not a hiding: an entry whose Addon is gone stays

Removing an Addon leaves every entry whose Title it supplied exactly where it
was, with `unplayable: { reason: "addon_removed", addon }` published beside it.
The entry is not deleted, not filtered and not greyed on the wire — a client is
told the fact and draws it as it likes; the window draws it as a card a person
cannot press, with the reason on it. This is the spec's own user story ("a Title
that came from an Addon I later removed … stays in my library as a stub") and its
own glossary ("unmapped is a mark, not a hiding").

The judgement is against **the Addon that supplied the Title** — the one the
client named — not the one the Stream came from. It is what has to still be
configured for the entry to be meaningful: the card came from it, and a resume
that went through some other Addon would be a different Title wearing its card.

Rejected: **deleting entries with the Addon** ("my history doesn't quietly
shrink" — the story); **hiding unplayable entries from the row** (a stub is a
mark); **marking them unplayable by the Stream's Addon** (not what supplied the
Title, and it would let a resume play a card the Host no longer has).

## A resume is a Host rule, and `/resume` is one of the two controls that open a Stream

The Continue watching row offers one click, and the click is `Action::Resume {
video }`. The client names the Video and decides nothing else: the Host reads its
own progress, asks every configured Addon that answers the Video's `stream`
request — the same path `FindStreams` uses — takes the first candidate it can
play, and opens it *at the stored position*. Nothing about the Stream URL is
stored (ADR-0013's presumption), so a resume is a re-ask and a fresh open, not a
kept handle.

An entry the Host has no progress for is refused with `no_progress`, and one
whose Addon is gone with the `unplayable` words the Snapshot already carries.
Playing it from the start instead would not be the thing the client asked for.

Rejected, with reasons: **the client doing `find_streams` → `play_stream` →
`seek`** (three Actions, the middle one opening at 0 and the seek refused while
the open is in flight — "where to resume from" would live in the client, which
ADR-0002 exists to prevent); **storing the Stream URL** (a credential — ADR-0013);
**a resume that picks the same release by `bingeGroup`** (continuity, and the
entry does not carry one: the first playable candidate is the simpler rule and
the position, which is what a resume is *for*, is unaffected).

## Opening a Stream is where a start position goes

`Player::open` gained a second argument: `open(url, start)`, where `start` is a
resume point or `None`. It is part of opening rather than a `Telling` because mpv
reads it when it *loads* the file: a `seek` sent first would move a Stream that
has not started, and a `seek` sent after would let the Stream begin in the wrong
place and jump. The two hard-won facts of this mechanism are in
`docs/research/mpv-control-facts.md`: `start` is a *string* property that refuses
a number, and it has to be set on every open, `none` for a Stream with no resume
point, so a later open does not inherit the position an earlier one began at.

Rejected, with reasons: **a `Telling::Start`** (a control a client can name would
be one it cannot use — a start is not something that happens while a Stream
plays, it is what the open *means*); **`loadfile`'s options argument** (mpv 0.38;
this container is 0.37); **the Host seeking once the Stream is live** (a visible
jump from 0, and the Host inventing a second mutation path into the Player outside
its open).

## The ended state offers the next episode directly, because the menu is not

The menu — where "Next episode" lives — is offered only while the Host would take
a control (opening, playing, paused), and a Stream at its end is not one it will
control (ADR-0013). A client that had just watched an episode would therefore
find the next-episode control *hidden exactly when it is wanted*. So the player
surface offers "Next episode" beside "Stop" while the state is `ended` and what
is playing is a series, and it is the same `next_episode` Action the menu sends.

Whether a next episode *exists* is still the Host's answer, and it may refuse:
the window offers the affordance and the Host says no (ADR-0002's duplicate-rule
rule). The `watchProgress` entry says the Video is watched; that it is *done* is
what makes the offer make sense.

## Consequences

The store gains a `watch_progress` table (migration 3) and the `Store` seam two
operations — `read_watch_progress` and `write_watch_progress` — with the same
domain vocabulary and the same in-memory fake as everything else. #30 merges into
the same entries and resolves by the stamp this ticket started writing; a
per-Title or per-Addon sync is a field on the entry and a rule above it. #31/#32
get the Continue watching row and the `resume` Action the same way they get every
other control, with no second path. The Windows walkthrough grew the resume
step: watch part of an episode, kill the Host, start it again, and pick the card
up from where it was.
