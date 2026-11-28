# Wire questions run off the connection thread

[ADR-0017](0017-pairing-and-the-wire-protocol.md) §2 chose one thread per wire
connection: the connection thread read a frame, called `Surface::dispatch`
inline, and pushed Snapshots and pings between reads.
[ADR-0022](0022-questions-fetch-outside-the-change-lock.md) moved question
fetches outside `HostDoor`'s change lock so one client no longer blocked
another, yet a single connection's frames were still serialized behind its own
slowest question. A Remote loading Home rows from a slow Addon could not pause,
seek, receive pushed Snapshots, answer pings, or get a prompt `Welcome` to a
greeting until those rows returned, forcing the Remote's
`LIVENESS.deadWhileAskingAfter` timeout up to 90 s (#349, #350).

This revises [ADR-0017](0017-pairing-and-the-wire-protocol.md) §2's
one-thread-per-connection rule.

## 1. Questions run on a bounded per-connection worker pool

When `Conversation::handle` receives a `ClientFrame::Command`, it runs the
connection's pairing check (`still_known`) and `host_core::permitted` inline as
before, then asks `Action::is_question()` — mirroring
`ValidatedAction::is_question()` in `host-core` so classification stays
single-sourced ([ADR-0022](0022-questions-fetch-outside-the-change-lock.md)):

- **Questions** are submitted to the connection's `QuestionPool` (`QUESTION_WORKERS = 4`),
  which spawns OS threads lazily up to the bound and queues excess questions on
  a per-connection channel. Workers dispatch through `Surface::dispatch`, clear
  `response.snapshots` (already published via `Broadcast`), and return
  `ServerFrame::Reply` or `ServerFrame::Refusal` on a per-connection reply
  channel drained by the connection loop beside `send_revisions` and `push`.
- **Changes, pairing, greetings, and `permitted` stay on the connection thread**
  in arrival order, so two controls are never reordered, pairing state and
  wrong-code attempt counts remain single-threaded, and `Hello` is answered
  immediately with `Welcome` and current `Snapshot`.

No async runtime is added: `host-wire` stays on OS threads and `std::sync::mpsc`
channels, matching the rest of the Host.

## 2. Out-of-order replies

Because questions resolve concurrently with the connection loop, a `Reply` or
`Refusal` for a question may arrive after replies to later commands, or after a
subsequent `Welcome`, `Snapshot`, or `Revision`. Clients already correlate every
command answer by `id` (`ClientFrame::Command.id`).

## 3. Remote liveness bound

Because a greeting is now answered promptly even while slow questions are in
flight, the Remote's `onTick` greets at `greetAfter` (12 s) while commands are
in flight, and `LIVENESS.deadWhileAskingAfter` drops from `90_000` (90 s) to
`45_000` (45 s) — still past `deadAfter` (30 s) and a single 30 s Change fetch
timeout (`add_addon`, `resume`), while halving the wait before replacing a dead
socket.

## Rejected, with reasons

- **Moving `host-wire` to an async runtime (`tokio`)**: rejected for the same
  reasons as ADR-0017 and ADR-0022 — the Host's transports and Player are
  blocking, and a handful of LAN devices need only OS threads.
- **Spawning an unbounded thread per question**: a client flooding questions
  would spawn unbounded OS threads; queuing behind `QUESTION_WORKERS = 4`
  bounds per-connection resources.
- **A Host-wide global worker pool**: one client flooding slow Addons would
  starve another client's connection, against ADR-0022's per-client isolation.
- **Offloading Changes as well**: two playback controls or pairing requests
  sent back-to-back must execute strictly in arrival order.

## Consequences

- Playback controls, greetings, pushed Snapshots, and WebSocket pings keep
  flowing on a connection while slow Addon questions are in flight.
- An active connection that asks questions owns at most `QUESTION_WORKERS` (4)
  worker threads; idle or unpaired connections spawn none.
- Question replies may arrive after later command replies; clients correlate by
  `id`.
