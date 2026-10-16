# Choosing a Stream: the Provider seam, the Addon's own words, and one location

Ticket #26 ("Choose a Stream") is the third question the Action surface answers,
after browsing (#23) and opening a Title (#24), and the first whose answer is
about something that could be *played* rather than looked at. ADR-0010 said a
question is answered with an `Answer` rather than a Snapshot and named this
ticket as one of the same shape; ADR-0011 named it among the capabilities "keyed
by the Video's own id". This is that shape, filled in — and it corrects
ADR-0011's letter about the Addon, below.

## One Addon's answer beside the others, and no ranking

`Action::FindStreams { video }` validates into `ValidatedAction::FindStreams`,
asks **every configured Addon whose manifest answers** a `stream` request for
the Video (`Manifest::answers`, ADR-0010's rule, with `stream` as its second
consumer after `meta`), and comes back as `Answer::Streams(Vec<AddonStreams>)`:
one group per Addon, in the order the Addons were configured, each group's
candidates in the order its Addon returned them. A group carries `streams` and
a `failure` — the shape a search's row already has — so one Addon being down, or
answering something that is not a stream response, is one group that says so
rather than a question that fails. That is the ticket's criterion in so many
words: "One Addon's failing `stream` response still shows what the others
returned."

The Host re-ranks nothing and merges nothing: AIOStreams' ordering is the
owner's configured priority, and an ordering the Host imposed would be a second
opinion about something it knows less about. Which candidates are *playable* is
the Host's judgment, and that is a different question from which comes first.
A Video no configured Addon answers for comes back as an answer with no groups
rather than a refusal — nothing was misunderstood, there is simply nothing to
play — and the window says so in a sentence rather than an error.

**ADR-0011 said the Streams of a Video are "keyed by the Video's own id and the
Addon its Title carries". The id, yes; the Addon, no.** The Addon that supplied
a Title's metadata is not the Addon that supplies its Streams, and the two are
usually different on purpose — Cinemeta answers what a film *is*, Torrentio
answers what it can be played *from*, and the ticket's failure criterion only
means something when several Addons are asked at once. So the client names the
Video as the protocol names it, a `{type}/{id}` pair ([`VideoRef`]), and the
Host decides which of its configured Addons that request reaches. The Title
still carries its Addon, because that is what opening it needed; asking for
Streams does not.

## The Provider seam

`Provider` is the Host's own way of turning a Video into playable candidates,
and the seam exists so that the Host's rules — whose answer is whose, the
configuration order, what one failure does to the others — are the Host's, and
what can be a candidate is not welded to the addon protocol:

- **`AddonProvider`** is the first implementation: one configured Addon's
  `stream` answer, fetched through the Host's one `Fetcher` and read by the
  pure parse below.
- **`FixtureProvider`** is the fake the seam is tested against, published beside
  `FixtureFetcher` and `InMemoryStore`: a Host test drives its ordering and
  failure rules with candidates a test wrote, and an unintended ask panics
  rather than answering blankly, the way an unrecorded URL does.

The seam's grain is *one source's answer*, because that is the grain the Host's
rules need (whose answer is whose, in which order, with which failures attached
to whom) and because the only kind of source this Host has is a configured
Addon. The glossary names other Providers — direct integrations, a torrent
bridge — and the seam is shaped so that a source that is not an Addon arrives as
another answerer asked beside this one, with `Stream`, the `Answer` and every
client unchanged above it; what identifies such a source is a question for the
ticket that brings one. Where #12's bridge lives — resolving an `infoHash` before
playback, or answering as a source with playable candidates — is #12's decision
too; what this ticket fixes is that an `infoHash` already has a shape to arrive
in.

The seam speaks in [`Stream`]s, not in addon objects, and that is the point of
it. An addon `stream` object has raw fields and implicitly claims that
everything it lists can be played; a `Stream` says where the bytes are *and
whether this Host can open them*. That is what lets "not playable yet" exist as
a value — the requirement the spec states and a shape the protocol has no room
for.

Rejected, with reasons: **a Provider that owns the fan-out** (it would have to
be handed the configured Addons, which is Host state below a seam; and the
rules the ticket is *about* — configuration order, one failure beside the rest —
would move to the far side of the fake, where the Action-surface tests could no
longer drive them); **no seam at all, the Host fetching Streams the way it
fetches meta** (an inline `fetch` in `dispatch`, so the next source kind arrives
as an edit to the Host's own resolution rather than as something a fake can
stand in for, and a candidate this version cannot play has nowhere to be
expressed); and **passing the `VideoRef` instead of the already-built request**
(`Manifest::answers` judges a request and the Addon must then be asked with
*that* request — a second construction is a second thing that can drift, the
rule opening a Title already follows).

## The Addon's words are kept verbatim

`name` is the Addon's own line for the candidate — AIOStreams' formatter writes
the badges into it (`[RD+]`, `1080p`, `4k DV | HDR`) — and it arrives exactly as
sent, newlines and all; the window draws its lines as badges. The description is
read from `description`, falling back to the deprecated `title` that Addons in
the wild (Torrentio among them) still answer with. The Host does not parse a
name into structure, because "which part of this text is the resolution" is a
question about someone else's formatting: the addon's formatter is the owner's
configuration, and re-reading it here would be the ranking engine this project
deliberately does not have. `behaviorHints.filename` and `bingeGroup` are read
onto the Stream itself, because the list shows them and story 21 asks for them.

`notWebReady`, `p2p` and `proxyHeaders` become `warnings`: surfaced beside the
candidate, never obeyed, and never a filter. A hint is the Addon's expectation
about clients — `notWebReady` is about *browsers*, and this Host's player is
mpv, which does not care that a URL is not https — and the clients here do not
agree about what they can play, so the fact travels and the judgment stays with
whoever can make it. `videoHash` — the sixth hint the spec lists — is the one
that is not read at all: it exists so a subtitle Addon can match a file, this
Host asks no subtitle Addon yet, and reading a field nothing acts on is a
promise this Host would not be keeping (ADR-0009). It arrives with the ticket
that acts on it.

## Exactly one location, and only the shapes this Host has

A protocol stream object locates its bytes with one of `url`, `ytId`,
`infoHash`, `externalUrl`, `nzbUrl` or an archive list, and **exactly one** of
them — counting only the fields that *say something*, because an empty string or
an empty list is absence serialized rather than a second answer, and treating it
as one would drop a playable candidate over a field some Addon writes empty. An
object carrying none, or more than one, is dropped — not guessed at, and not
refused as a whole: one candidate out of a page is one candidate, the same rule
a catalog item already gets (ADR-0010).

A single location that is a shape this Host does not have is not a candidate: a
YouTube id, an external web page, an archive it cannot unpack. The reasons are
the ones the repo already keeps: nothing in this Host would ever play one, and
"reading a field nothing acts on is a promise this Host would not be keeping"
(ADR-0009). Story 20's "listed but marked unplayable" is about the candidates a
*later ticket* makes playable — #12's torrent bridge — and that is why an
`infoHash` is the one unplayable shape that is listed: it has a shape here
(`Playback::InfoHash`) waiting for the bridge, where a web page has none.

This is visible with real data: the recorded WatchHub answer — Amazon, Google
Play, Telecine, each an `externalUrl` — reads as *no candidates*, because it is
an answer of places to watch rather than an answer of places to play.

Rejected, with reasons: **listing `externalUrl` objects as unplayable
candidates** (a candidate no code path will ever reach is a promise the list
would not be keeping, and it puts "Rent, Buy" links next to torrents as if they
were the same kind of offer); **reading `fileIdx` and `sources`** (nothing here
acts on a torrent's file index or trackers yet — #12 is where they arrive);
**refusing the whole answer when every candidate is dropped** (an Addon whose
answer holds nothing playable answered; the group says so); and **caching the
answer** (a Stream list is asked at the moment of pressing play, like ADR-0011's
meta answer and for the same reason — the Addon's `cacheMaxAge` is a hint for
paging through a catalog, not for what can be played right now).

## Consequences

A question adds an `Action` variant, a `ValidatedAction` variant and an
`Answer` variant (ADR-0010 said so, and this is the third one), plus
`ActionError::Stream` for a body that could not be read at all and
`InvalidVideoRef` for a Video that is not one. #27 plays a `Playback::Direct`
candidate and reports a failed open back to this same list; #12 turns a
`Playback::InfoHash` into bytes without any of these shapes changing; and every
client that can take Actions can choose a Stream the day it exists in the
window, because the capability went onto the single surface and not into a
client (ADR-0002).
