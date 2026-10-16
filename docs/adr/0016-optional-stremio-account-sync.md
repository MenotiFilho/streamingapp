# Optional Stremio account sync: bidirectional merge, pure decision surface, and credential storage

Ticket #30 ("Optional Stremio account sync") adds bidirectional reconciliation
between the Host's Library and a personal Stremio account. Seven architectural
decisions are recorded here.

## 1. Sync is strictly optional and zero-overhead by default

With sync off (the default), the Host makes zero network calls to Stremio's API.
The Host is constructed with an optional `StremioApi` seam via `.with_stremio(...)`.
Even when an implementation is wired in, nothing reaches Stremio until the owner
explicitly signs in (`Action::SignInStremio`). A Host without a signed-in account
or with sync disabled operates purely off its local SQLite store.

Rejected, with reasons: **mandatory account sign-in** (contradicts the local-first,
clean-room architecture established in ADR-0001); **polling Stremio on a timer**
(the Host holds no background timers or runtimes, and polling would waste bandwidth
and battery).

## 2. Credentials live in the secret store and never enter Snapshots or logs

Signing in takes an email and password via `Action::SignInStremio`. The password
is wrapped in a `Password` type whose `Debug` implementation is `[REDACTED]` to
prevent accidental leakage in test failure outputs or debug logs. The password
is exchanged once with `https://api.strem.io/api/login` for an `authKey`.

The `authKey` is written directly to the OS keyring or owner-only file via
`host-secret` under `CredentialKind::StremioAuthKey`. At no point is the `authKey`
or password held in `State`, serialized into a `Snapshot`, or recorded in logs.
`Snapshot.protection` exposes only a boolean `stremio_held` so the client UI can
render sign-in status without accessing secrets.

Rejected, with reasons: **storing credentials in SQLite or plain settings** (violates
security boundary; credentials belong exclusively in the secret store); **passing
credentials through Snapshots** (Snapshots are broadcast to all connected IPC and
remote clients).

## 3. The `StremioApi` seam lives outside `host-core`

In keeping with ADR-0009 and ADR-0013, `host-core` contains only the `StremioApi`
trait and error definitions. The real network client `HttpStremio` lives in
`host-addon`, using blocking `ureq` calls with native platform TLS and trust
stores (schannel on Windows, OpenSSL on Linux).

In tests, `FixtureStremio` provides an in-memory mock that records calls and
simulates remote library states, auth rejections, and network failures deterministically.

Rejected, with reasons: **putting HTTP clients inside `host-core`** (would infect
core domain logic and tests with network runtimes and async baggage).

## 4. Merge is a pure decision surface

All synchronization and conflict resolution logic lives in
[`crates/host-core/src/sync.rs`](../../crates/host-core/src/sync.rs). The `merge`
function takes local `WatchProgress` records, an optional `RemoteItem`, an optional
canonical episode list for series, and the current timestamp — and returns a `Merged`
struct containing local changes to adopt and an updated `RemoteItem` to push.
It performs no I/O, spawns no threads, and cannot panic.

Rejected, with reasons: **intertwining HTTP requests with merge logic** (untestable,
error-prone, and prone to partial-state corruptions); **performing database writes
inside the merge routine** (`Host` retains ownership of state and store writes).

## 5. Timestamp conflict resolution in both directions

When both the local Host and the remote Stremio account hold progress for the same
Title or Video:
- If the remote `_mtime` (ISO-8601 UTC timestamp) is newer than the local entry's
  `updated_at`, the remote position and watched status are merged into local state.
- If the local `updated_at` is newer, the local progress is pushed to the account.
- If timestamps are identical, neither side is modified.

Timestamps from Stremio are parsed from ISO-8601 strings to millisecond epochs
using pure civil date conversion (Hinnant's algorithms) without depending on heavy
external date-time crates.

Rejected, with reasons: **always letting remote win** (would wipe out local progress
made offline); **always letting local win** (would overwrite progress made on other
Stremio devices like TVs or phones).

## 6. Watched bitfields are merged as bitwise unions

Stremio stores series episode watched state as a compressed bitfield string
formatted as `{anchor_video}:{anchor_length}:{bitfield}` where the bitfield is
compressed with zlib and encoded with base64.

Crucially:
- A progress position update must not overwrite or clear watched episodes.
- When merging series progress, watched states from local entries and the remote
  bitfield are unioned (OR'd).
- If the Addon's catalog drifts and changes total episode count, the bitfield is
  re-anchored using the canonical episode order so bit indices remain aligned
  to the correct episodes.

Rejected, with reasons: **treating watched status as a binary flag on the whole Title**
(destroys per-episode progress tracking); **ignoring the bitfield and only syncing
the last played position** (causes Stremio apps to mark earlier episodes as unwatched).

## 7. Lifecycle integration: open pulls, pause/stop/exit push, failures degrade gracefully

- **On open**: `HostHandle::pull_remote()` is invoked in a background thread on
  application launch. Any newer progress from the account is merged into the library
  and published as a Snapshot.
- **On pause and stop**: Any Video currently playing has its progress pushed to
  Stremio via `datastorePut`.
- **On exit**: Tauri's `RunEvent::Exit` hook calls `HostHandle::shutdown()`, which
  records the final playback position and pushes it to the account.
- **Graceful degradation**: Network drops, API timeouts, or server 5xx errors
  return non-fatal `SyncError`s. Playback and local library writes continue
  uninterrupted.
