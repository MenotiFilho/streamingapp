# Live conformance: read-only against real Addons

Ticket #33 asks for one read-only command that runs the Host's addon path
against real Addons and reports what it finds, so that the transport is
exercised against the ecosystem it is built for rather than only against
recorded fixtures. Three decisions are worth writing down: where the run lives,
what it is allowed to do, and what its report prints.

## The run is its own crate, outside `host-core`

The engine and the `live_check` binary live in `crates/host-live/`, which depends
on `host-core` (the vocabulary and the parsers), `host-addon` (the real
`Fetcher`), and `host-torrent` (the real `TorrentEngine`, added in #346). It is
outside `host-core` for the same reason the transports are: it reaches the
network, and `host-core` knows nothing of it (ADR-0009, ADR-0042). It is not in
`host-addon` either — that crate's whole reason is that it "knows nothing about
Addons beyond fetching a URL", and the run is exactly the composition of the
transports with the Host's parsers, which is a thing neither crate is. It is not
in `src-tauri` for the opposite reason: that shell links the UI toolkit, and a
diagnostic that compiles Tauri to ask one Addon a question is the window's weight
paid for the airport's purpose.

Rejected: **the engine in `host-core`** (it would put HTTP under every test in
the repository, which is what ADR-0009 exists to avoid); **in `host-addon`**
(its scope would grow from "fetch a URL" to "run the addon path", and the next
such tool would have nowhere to go); **in `src-tauri`** (the app shell would hold
rules, which AGENTS.md says it must not).

## Read-only, and it never fails on third-party content

The engine takes two seams: a `&dyn Fetcher` and a `&dyn TorrentEngine` (#346).
Every HTTP ask is a `GET` through the `Fetcher`. When an Addon returns a torrent
Stream for the run's Video, the run hands the first torrent Stream to the
`TorrentEngine` — backed by a temporary torrents directory that is removed on
exit — to wait for metadata only (bounded at `METADATA_BOUND`, 60 s), reporting
time to metadata, peer count and the chosen file before calling `let_go` without
requesting any video bytes. It holds no `Store`, no Stremio client and no
credential — so there is no code path here to a write to the Addon, to Stremio
or to the Host's own store. The question is a report, not a test suite: one Addon
being down is a line in the report, and the run still exits `0`. An unknown
option, or a URL that is not a manifest URL, exits `2` instead, because those are
the command's mistake rather than a fact about someone else's content.

Each ask reports one of four outcomes — `ok`, `empty`, `malformed`,
`unreachable` — and, when the resource is a list, how many things the answer
carried. The manifest is asked first and decides the rest: which resources to ask
is the manifest's own answer, so an Addon whose manifest cannot be read is an
Addon with nothing to ask. Every other ask goes through `Manifest::answers` and
`ResourceRequest` exactly as the Host's do (ADR-0010), and every answer is read by
the same parser the Host reads it with, so the report is what the Host would
actually see.

## The report prints the manifest URL

ADR-0009 keeps the manifest URL out of a Snapshot because, for an Addon like
AIOStreams, it carries the debrid configuration. The conformance report prints
the URL the owner ran the command with, and each ask carries the URL it asked at.
That is deliberate: a conformance report that hides where it went cannot be acted
on, and this is a diagnostic on the owner's own machine, not something published
to a paired client. A report is therefore treated as the manifest URL it came
from, and the command says so. Rejected: **redacting the URL** — a failure report
that cannot name the URL it failed at is not worth printing.

Consequences: a new diagnostic over the Host's addon path is another crate beside
this one rather than a change to it; the run is documented in `AGENTS.md` as one
of the verification commands; and the four outcomes are the report's own
vocabulary, so a resource added to the protocol later is another ask with an
outcome, not a change to what an outcome is.
