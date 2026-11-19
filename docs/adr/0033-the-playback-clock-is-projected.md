# The playback clock is projected, and a position is not a publish

Ticket #182's follow-up. ADR-0013 decided that the Host samples its Player and
publishes a Snapshot when something moved; it rejected "publishing on every
tick" because the revision would move four times a second to say nothing. In
practice a moving position *was* that tick: every sample returned a new
`PlaybackSession`, so every sample published a whole Snapshot — about 42 KB,
four times a second, to every paired device. A phone on a lossy Wi-Fi link paid
for the entire state to learn where the clock had got to, and a play/pause
command arrived in the middle of that stream.

This records the correction: **a position is an anchor, and the clocks are
projected by the clients.**

## 1. What publishes

`Host::sample()` still folds every Player report into the Host's own record — a
pause, a seek, a stop and a crash-safe Watch progress write all need the latest
position. Publication is narrower:

- a **public change** publishes: the Stream and its state, the duration, the
  buffered span, whether playback is stalled (`stalled`), the Torrent status
  (`torrent`), a failure, the track list, the chapters and the current chapter,
  speed, volume, mute, subtitle delay, crop, aspect, resolution;
- a **Watch progress write** publishes, because it is the low-rate correction
  and the write already happens at `PROGRESS_EVERY` (5 s);
- a position that moved, and statistics that moved, do not publish by
  themselves.

The choice is `PlaybackSession::differs_publicly_from`, a pure comparison next
to `advanced`. It names the two fields a client owns — `position` and
`statistics` — rather than trying to classify every future field by hand.

`buffered` and `torrent` stay public on purpose: neither a cache span nor live
swarm progress is a clock a client can project. Both are throttled rather than
published on every tick: the `buffered` comparison ignores a span that moved by
less than a second at both ends (ADR-0013), and `Host::sample()` throttles
`Torrent status` (`torrent`) publication to at most once per second
(`TORRENT_STATUS_EVERY_MS`, 1 s).

## 2. How the clients read a position

Both clients record when a Snapshot arrived and project:

```text
position + max(0, now - anchor) × speed, clamped to duration
```

- A new Snapshot is a new anchor: a pause, a seek, a speed change, a track
  change or the 5 s Watch progress correction moves it at once.
- A paused Stream holds its position; a hidden surface does not repaint.
- The window projects through `usePlaybackPosition` while the OSD is up, and the
  served Remote projects through `livePosition` with a 250 ms local interval
  while the cast card is open.
- The Remote's Picture statistics readout updates on the Snapshots it does
  receive; it is not a reason to wake every client four times a second.

## 3. What this does not change

The Action surface, the wire frames, the Snapshot shape and the one door stay
as they are. A client that has just connected or reconnected is still sent the
whole state, and the next public change still carries the current position. The
difference is how often a *healthy* connection is interrupted with the whole
state to report a number both ends can derive.

Rejected, with reasons: **publishing every tick and hoping the phone keeps up**
(a 42 KB Snapshot at 4 Hz is the thing being fixed); **a new position frame**
(it would add a second thing to version, parse and test for a number the client
can compute from the anchor and its own clock); **client polling** (ADR-0013
already rejects a remote that has to ask, and it would make an idle Host the
only one that can answer); **dropping the buffered span from public changes**
(the read-ahead bar would freeze while paused, which is when it is most useful).
