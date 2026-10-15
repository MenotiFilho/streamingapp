# A thin app shell over library crates, and one versioned Action surface

The Host's first vertical slice (#21) puts the spine in place that every later
ticket hangs off, so its shape is a decision rather than an accident.

**Layout: `crates/` is the Host, `src-tauri/` is a window.** `host-core` holds the
state, the Action surface and the Snapshot; `host-sqlite` holds the only SQL;
`host-logging` holds the log format. None of them knows Tauri exists. `src-tauri/`
resolves platform directories, starts the three, and registers two IPC commands —
it holds no rules. The test for this is a practical one: `cargo test -p host-core`
never compiles a UI toolkit, so the decision seams stay cheap to run, and a
capability that only exists because a window exists is visible as such.

**One versioned envelope, from every client.** A mutation is
`{"version":1,"action":{"type":"set_subtitle_language","language":"pt-BR"}}`. The
version is judged before the Action is, so a client that is too old or too new
hears exactly that instead of a complaint about a field it has never heard of. The
Tauri command takes the envelope as raw JSON and hands it to
`Action::parse_value`, so a malformed Action is reported in the Host's vocabulary
rather than the IPC layer's — which is what makes the WebSocket adapter in #31 a
second thin translator rather than a second surface (ADR-0002).

**Validation is a step, and the type says so.** `Action::validate` consumes the
Action and returns a `ValidatedAction` carrying domain types. Only that reaches
state, so "nothing invalid mutated anything" is enforced by the compiler rather
than by the order of two statements. Then the store is written, and only then is
the in-memory state replaced: an Action the store refuses leaves the Host exactly
where it was. Tests hold both halves — a rejected Action never reaches the store,
and a store that cannot write publishes nothing.

**The Snapshot declares its own shape.** It is built by a pure function of state,
it carries a monotonic `revision` so a client can ignore an older update, and it
has no field a credential could occupy — a test walks its JSON and fails on any
field named like a key. Adding to the Snapshot is how state reaches clients; there
is no other way.

Rejected, with reasons: **one crate for everything**, because every test would
then link webkit; **the Tauri command as the surface**, because the remote client
would immediately need a second one; **validation inside the reducer**, because an
invalid Action would then mutate halfway; **`language: Option<String>` in the
Action**, because serde reads a missing or misspelled field as `None` and a typo
would silently clear the preference (hence `SetSubtitleLanguage { language }` plus
an explicit `ClearSubtitleLanguage`); and **a JSON document instead of SQLite**,
for the query and migration reasons the spec already gives.

Consequences: a new capability is an `Action` variant, a `ValidatedAction`
variant and a field in the Snapshot, and it is reachable from every client the
moment it is parsed; the TypeScript client mirrors the wire types by hand, so a
change to them is a change in two places and the version in the envelope is what
tells a stale client.
