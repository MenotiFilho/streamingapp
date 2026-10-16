# streamingapp

A personal (later open-source) front-end for the Stremio addon ecosystem: a Host
that resolves playable sources and plays them with an embedded mpv, a
Netflix-style browsing UI, and an API that lets any client control the Host.

## Language

**Host**:
The process on the user's computer that owns all state — configured addons,
catalogs, watch progress and playback — and exposes an API to clients.
_Avoid_: server, core, daemon, backend, instance

**Snapshot**:
The Host's periodic state message pushed to clients, carrying now-playing and
library state.
_Avoid_: state, payload, update

**Action**:
A request from a client that the Host change something, carried in a versioned
envelope and judged before it is applied. The Action surface is the only way the
Host is ever mutated.
_Avoid_: command, request, event, message

### Identity

**Title**:
A film or series as a metadata identity, keyed by its TMDB id when one exists,
otherwise by whatever addon supplied it.
_Avoid_: meta, item, content, media

**Unmapped Title**:
A Title still keyed by the addon that supplied it: nothing mapped it to a TMDB
record. It stays visible and says so — unmapped is a mark, not a hiding.
_Avoid_: unmatched, missing, broken item

**Video**:
One playable unit of a Title: the film itself, or a single episode. Watch
progress is recorded against a Video.
_Avoid_: episode (for films), media, stream

### Sources

**Addon**:
A service the Host is configured with that speaks the Stremio addon protocol.
_Avoid_: plugin, extension, provider

**Manifest**:
An Addon's own description of itself: the id it answers to, its name and version,
the resources and types it covers, and the catalogs it offers.
_Avoid_: descriptor, metadata, document

**Catalog**:
One feed of Titles an Addon offers — a row a client browses — asked for by the
type and id the Addon gave it, with the `extra` values it declared (`skip` to page
on, `search` to search, `genre` to filter).
_Avoid_: feed, list, collection

**Meta preview**:
One item in a Row, as the addon protocol carries it: the id, name, poster, year
and description a card is drawn from, before opening it makes a Title. The
protocol's own word for a catalog item; the wire field is `metas`.
_Avoid_: meta (unqualified), item

**Row**:
One Catalog's answer, as the Host sends it to the client that asked for it: the
items, and why there are none when the Addon did not answer. A client keeps its
own accumulated row — what it has paged to and where it has read to — and that is
never shared state.
_Avoid_: page, results


**Provider**:
The Host's internal seam for turning a Video into playable candidates. The
Stremio addon protocol is one Provider; direct integrations (local files,
TorBox, a torrent bridge) are others.
_Avoid_: source, backend, resolver

**Stream**:
A candidate a Provider returns for a Video: either a direct URL that can be
played immediately, or an infoHash that something else must turn into bytes
first.
_Avoid_: source, link, result

### Credentials

**Credential**:
A secret the Host holds so it can speak to a service on its owner's behalf — the
TMDB key today. It lives in the secret store, is read at the moment of use, and
never enters Host state or a Snapshot.
_Avoid_: token (unqualified), password, secret (unqualified)

**Secret store**:
Where credentials are kept: the OS keyring where one exists, an owner-only (0600)
file in the data directory where it does not. Which one is holding them is a fact
about the machine, not a setting.
_Avoid_: keychain, vault, config

**Protection**:
Where the Host's credentials actually live, and whether it holds one — the one
credential fact a Snapshot carries.
_Avoid_: storage, security, exposure

### Playback

**Player**:
The Host's seam for playing a Stream: open it, hold it, move in it, let it go —
and what it says about where playback is. mpv is the implementation, linked
in-process, and it keeps the picture; the Host's interface is drawn above or
beside the video and never sees a frame.
_Avoid_: mpv (for the seam), backend, engine, renderer

**Picture**:
Where the Player draws the video: inside the same window as the Host's
interface, in a window of its own, or nowhere at all. A fact about the machine
— not a setting, and no Action changes it — and one every Snapshot carries, so
that a client sharing the Host's window knows where the hole for it goes.
_Avoid_: video output, surface, canvas, screen

**Now playing**:
The Stream the Host is on, as every client is told of it: the Video, the Addon
whose answer it came from, and the Addon's own words about the candidate. Never
where its bytes are — a Stream URL can carry a debrid session, and a Snapshot
reaches every paired client.
_Avoid_: current stream, playing media, file

**Watch progress**:
The resume state the Host stores for a Video.
_Avoid_: progress (unqualified), history

**Playback position**:
How far into the Stream playing now the Host is, in seconds: the Host's own
record, moved at the moment of a control and corrected by the Player's next
report.
_Avoid_: progress, timestamp

**Track**:
One of the Stream's own soundtracks or subtitle streams, as the Player numbers
it: what a client names to select one, and what the Host refuses an unknown id
against. A track that came in the file is *embedded*; one the Host added
afterwards is not.
_Avoid_: stream (for a track), language, audio

**Chapter**:
A marker the Stream's container carries into itself — a place in the Stream a
client can move to by name or by position in the list.
_Avoid_: cue, marker, bookmark

**Crop**:
The rectangle of the picture that is kept, in the source's own pixels; the rest
is not drawn. Never a setting of the Host's: a control a client takes, and the
stock autocrop script is the other thing that moves it.
_Avoid_: zoom, pan, letterbox

**Aspect**:
The shape the picture is drawn at, where the owner overrides the shape the
Stream itself carries — "the source's own" being the absence of an override.
_Avoid_: ratio, scaling, stretch

**Statistics**:
What the Player reports about *how* a Stream is playing rather than what is
playing: the bitrate it is reading, the frames it has dropped, and what is
decoding the picture.
_Avoid_: stats, metrics, performance

**Telling**:
One thing the Host asks of its Player: a control named in the Host's own terms,
which only the Player's implementation knows how to spell. A capability is a
Telling before it is anything a client sees, so that no client can have one the
seam does not (ADR-0002).
_Avoid_: command, instruction, mpv call

