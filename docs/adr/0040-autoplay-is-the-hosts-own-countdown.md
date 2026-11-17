# Autoplay is the Host's own countdown

Spec #302, ticket #316. When an episode's Stream reaches its end the Host used
to stop on `PlaybackState::Ended` and wait for a client to press **Next
episode**. Autoplay moves on by itself after a short countdown everyone can see
and stop. This is the first time the Host plays something no Action asked for at
that moment, so the decision is written down: **the countdown is the Host's, not
each client's.**

## 1. The countdown is Host state, published in `PlaybackSnapshot`

On the `sample()` tick where playback becomes `Ended`, for an episode, with the
**Autoplay** preference on, and with a next Video that has aired, the Host starts
a countdown of `AUTOPLAY_COUNTDOWN_MS` (5 s). It is published as
`PlaybackSnapshot.autoplay`: the next episode (its Title, Video, Episode, name
and still) and a `phase` tagged `countdown { remaining, duration }`. It is
`null` whenever nothing is pending.

`remaining` and `duration` are *relative seconds*, so a client projects the digit
on its own monotonic clock from the Snapshot's arrival and never compares wall
clocks with the Host, the same rule as the playback position (ADR-0033). The
countdown is published when it starts and again when it ends (a play, a cancel,
a stop), not per tick; a Snapshot built mid-countdown, for example for a Remote
that reconnects, carries the `remaining` true at build time.

One clock means a paired Remote and the window never disagree about when the
next episode starts, and a Host with no client attached still advances.

## 2. It is anchored to the injected `Clock` and checked in `sample()`

The Host stores the moment the countdown started on its `Clock` seam. The shell
already calls `sample()` on a fixed cadence (`SAMPLE` in `src-tauri/src/main.rs`),
so no thread or timer is added: `host-core` still holds neither (ADR-0013,
ADR-0033). The expiry is checked at the top of `sample()`, *before* the early
return on an unchanged observation, because a Stream sitting on its last frame
reports the same thing forever and the countdown must still run out. A test
drives it with a `FixtureClock`.

The countdown is the Host's own record beside `State`, never persisted: a
restarted Host comes back with none.

## 3. When it runs out, `sample()` does Addon I/O

At expiry the Host plays the next episode exactly as `next_episode` would: the
same list of Videos, then the same Addon's candidate with the same `bingeGroup`,
else that Addon's first playable candidate (ADR-0012, ADR-0014), and the same
`Change::Play` with fresh Watch progress carrying `stream_addon` and
`binge_group`. The `stream` request is I/O inside the tick. That follows the
precedent of the subtitle fallback, which asks the Addons from the tick for the
same reason (ADR-0014): a Stream that needs something needs it whether or not a
client is attached.

The report the tick read describes the Stream that ended, so the tick returns
the play's Snapshot straight away rather than folding that stale report into the
new Stream.

Where continuity finds nothing (the Addon is gone, errors, or has no playable
candidate), the Host opens nothing and stays on `Ended`, and it says so: the
countdown becomes `phase: no_stream { detail }` for the same next episode, with
the refusal's reason in `detail`. Nothing runs any more, and it ends as a
countdown does: a cancel, a stop, a play, switching Autoplay off. Clients on
their player surface open the **Streams picker** for that episode once per
target (`opensPicker`); the window on its player level, the Remote only on its
expanded card, so a Remote on a browse screen is not torn off it. The ended
state itself is drawn as it always was. The "Still watching?" hold (§6) is a
third phase and not a case of this one: it is not a failure.

## 4. Ending the countdown

- `cancel_autoplay` (new Change Action, no payload) ends this countdown and keeps
  the preference. With nothing pending it publishes nothing and moves no
  revision, so two clients pressing Cancel together is harmless.
- `set_autoplay { autoplay: false }` ends it; `set_autoplay { autoplay: true }`
  while sitting on an ended episode starts one.
- `stop_playback` ends it, and every play Action (`next_episode`,
  `previous_episode`, `play_stream`, `resume`, `play_up_next`) replaces it with
  the new Stream.

## 5. Where it stops

A pure decision, `autoplay::on_ended`, takes the next Video (or none) and the
clock. There is no countdown at the series' last numbered episode, at the last
special, or when the next Video's `air_date` is after today in UTC. A finale
leads into the next season's first episode, and no step crosses between the
numbered seasons and the specials (ADR-0039). Films are never touched: Autoplay
acts only on a Stream whose Video is an episode.

## 6. Where it holds: "Still watching?"

A Host that advances on its own must stop before an unattended run goes on all
night. The Host keeps a counter beside its state: not published, not persisted.
It goes up by one on each auto-advance, and it goes back to 0 on any client
Change Action (a pause, a seek, a volume, a play) except `look_hint`, which is a
client warming a Title and not a person being there. `autoplay::attends` is that
rule, and a pure function.

When an episode ends with a next Video that has aired and the counter at
`UNATTENDED_LIMIT` (3: one episode a person started or touched, then three that
played on their own), `on_ended` answers `Hold`. The Host publishes
`autoplay: { next, phase: "unattended_limit" }`: no countdown, so it never runs
out. A Change during the hold resets the counter but starts nothing: only a play
(`next_episode` from **Keep watching**) moves on, and `cancel_autoplay`,
`set_autoplay { autoplay: false }` and `stop_playback` dismiss it. With nothing
to advance to (the last episode, an episode that has not aired) there is nothing
to ask, so the hold is never offered.

## Rejected

- **Client-owned countdowns.** Each client runs its own five seconds and sends
  `next_episode` at the end. Two clients race, the one with the slower clock
  plays a second episode (or is refused), and an unattended Host with no client
  never advances.
- **Advancing at once, with no countdown.** There would be no chance to stop it.
  The countdown is the cost of a Host that acts on its own.
- **A timer thread in `host-core`.** It would break the rule that the crate holds
  no threads and no timers, and it would make the tests wait on real time.
