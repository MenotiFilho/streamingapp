# A blocking Fetcher, Addons keyed by their manifest id, and a URL that never leaves the Host

Ticket #22 ("Configure Addons by manifest URL") is the first time the Host reaches
the network, so its shape is a decision rather than an accident. Four of them are
worth writing down.

**The Fetcher seam is synchronous.** `host_core::Fetcher` is
`fetch(&self, url) -> Result<String, FetchError>` — and, since #25, a second method
with a default, `fetch_with_headers(&self, url, headers)`, which the real transport
implements and a test double records — because the TMDB credential that is a v4
read-access token travels in an `Authorization` header, so the seam has to carry
one without every fetcher implementing both. The real implementation blocks.
Everything the Host ever asks a third party for goes through it: a manifest today,
catalogs and Streams later. The Action surface is a door one client goes through at
a time, and a manifest fetch happens because the owner asked for one, so the Host
can afford to wait for it. The alternative — an async trait with an executor under
it — would put a runtime into `host-core`, into every test in the repository, and
into the signature of `Host::dispatch`, to serve a request the owner initiates by
hand. The cost is paid where it belongs instead: the app shell's `dispatch` command
is declared `#[tauri::command(async)]`, so a fetch runs off the main thread and the
window does not freeze on someone else's server. When #31's WebSocket adapter
arrives, the same call goes inside `spawn_blocking`; that is a contained change, and
this ADR is what it should be measured against.

_Amended by [ADR-0017](0017-pairing-and-the-wire-protocol.md): the adapter arrived,
and it does not use `spawn_blocking` — it uses one OS thread per connection, and no
async runtime at all. The intent here ("a fetch must not block the caller's loop")
is kept; the mechanism named above is superseded, because there is no runtime to
`spawn_blocking` from._

_Amended again by [ADR-0022](0022-questions-fetch-outside-the-change-lock.md): the
Fetcher stays blocking, but the "door one client goes through at a time" rationale
now covers changes only. A question clones a frozen view under a short lock and
fetches outside it, so one slow Addon no longer queues every other client behind
it._

**An Addon's manifest URL is a credential by presumption.** For an Addon like
AIOStreams the debrid configuration lives *inside* the URL, which is what the spec
asks for ("the Host never has to hold a debrid key itself"): the Host stores the URL
and uses it whole, and extracts nothing from it. That makes the URL the one thing a
Snapshot must never carry — a Snapshot reaches every paired client — so the state a
client sees is the *manifest*: id, name, version, resources, types, catalogs,
behaviour hints. `Addon` on the inside is the URL plus that manifest; the wire shape
is the manifest alone. `the_manifest_url_never_reaches_a_snapshot` holds that line
by asserting the URL and a marker inside it appear nowhere in a serialized Snapshot.
The same rule is why the Host logs an Addon by id and never by URL, and why a stored
manifest that will not read back says so without repeating the URL.

**An Addon is identified by the id inside its manifest.** Removal names that id, and
adding an Addon whose id is already configured replaces it — a reconfiguration. The
alternative, keying by URL, is more faithful to Stremio's own addon collection (which
matches on `transportUrl` and can hold two configs of one Addon), but it gives a
client nothing to name an Addon by that is not the secret itself: an opaque
Host-generated id, or a hash of the URL, is machinery whose only purpose is to hide
one field. Naming an Addon by its manifest id costs the ability to run two configs
of the same Addon at once — a limit worth revisiting if that turns out to matter, and
one that a later ticket can lift by giving the URL a handle at the store seam.

**The store keeps the Host's reading of the manifest, not the bytes the Addon
served.** A row is `(id, position, url, manifest)`; `manifest` is the parsed
`Manifest` as JSON. Keeping the raw body instead would mean re-parsing on every read
and either re-parsing on every Snapshot build — which is pure today and would stop
being so — or carrying the raw text next to everything derived from it. Storing the
vocabulary keeps `Snapshot::build` pure and the seam in domain types. The price is
that any field a later ticket adds to `Manifest` must carry `#[serde(default)]` to
read rows written before it, or a stored Addon becomes unreadable and the Host says
so loudly at startup rather than quietly losing what the owner configured; that is a
cheap price, and a schema change here is a migration like any other. The values
inside that JSON are judged the same way a fetched manifest is — `AddonId` and
`ManifestUrl` deserialize through their parsers — so reading from the database is
not a way for a value the parser would refuse to get in.

Rejected, with reasons: **fetching outside the Host** (the window or the shell would
hold the transport, and the fixture-backed Fetcher could not be a test double for
Host behaviour) — the spec puts Addon transport in the Host; **publishing the
manifest URL** (a Snapshot is broadcast to every paired device, so the URL and the
key inside it would go with it); **validating the manifest in the same step as the
fetch** (validation is pure and comes first, so a URL that is not a URL is refused
without a request; the fetch and the parse follow, and if either fails, nothing has
been stored or published); **reading the manifest fields this ticket does not need**
(`description`, `logo`, `background`, `addonCatalogs`, the SDK's `cacheMaxAge` /
`staleRevalidate` / `staleError` hints) — the spec's list for a manifest is exactly
id, name, version, resources, types, `idPrefixes`, catalogs and behaviour hints, the
cache hints belong to the ticket that caches, and these arrive with
`#[serde(default)]` when they do; and **putting the HTTP client in `host-core`** (its
own module documentation says it knows nothing about the network, and `cargo test -p
host-core` should never build a TLS stack).

Consequences: adding a control that reaches the network is a new `Fetcher` call plus
the `#[tauri::command(async)]` door it arrives through; a capability that needs an
Addon's URL must read it from the store and never from a Snapshot; the fixture
Fetcher panics on an unrecorded URL, so a unit test that accidentally wants the
network fails loudly instead of flaking; and a manifest that is malformed, hostile,
or answers with a web page is a typed `ActionError` variant the window can explain,
not a panic.

**Corrected later:** this ADR lists the SDK's cache hints (`cacheMaxAge`,
`staleRevalidate`, `staleError`) among the manifest fields the Host does not read.
They are not manifest fields — the SDK serves them on the *resource response*.
Ticket #23 reads them there; see ADR-0010.

