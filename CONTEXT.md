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
A request from a client, carried in a versioned envelope and judged before it is
resolved. An Action is either a **Question** or a **Change**, and the Action
surface is still the only way the Host is ever mutated.
_Avoid_: command, request, event, message

**Question**:
An Action that reads rather than mutates: browsing a Catalog, searching,
Discover, opening a Title, finding Streams. It is answered to the client that
asked, publishes no Snapshot and moves no revision, and resolves from a frozen
view of the Host taken at dispatch, outside the Host's one lock (ADR-0022).
_Avoid_: query (unqualified), read, fetch

**Change**:
An Action that mutates the Host's state — Addons, preferences, credentials,
paired devices, playback — and is published as a Snapshot to every client. It
holds the Host's one lock for the whole of its I/O (ADR-0022). Autocrop is a
Change whose telling moves no Host state — the Player finds the rectangle and a
later report carries it — and is published like any other. (The resolved state
transition a Change makes inside the Host is also called a `Change` in code; this
entry is the Action.)
_Avoid_: mutation, command, update

### Identity

**Title**:
A film or series as a metadata identity, keyed by its TMDB id when one exists,
otherwise by whatever addon supplied it.
_Avoid_: meta, item, content, media

**Unmapped Title**:
A Title still keyed by the addon that supplied it: nothing mapped it to a TMDB
record. It stays visible and says so — unmapped is a mark, not a hiding.
_Avoid_: unmatched, missing, broken item

**Discovered Title**:
A Title TMDB named before any Addon did — the inverse of an Unmapped Title:
always keyed by its TMDB id, and possibly unknown to every Addon. A client opens
it against TMDB, and its Streams are asked of whichever Addons accept the id.
_Avoid_: TMDB item, found title, catalog item

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

**Featured catalog**:
The one Catalog the owner has marked as the Host's featured feed — what a
client's Home hero is drawn from, its first items in the Addon's own order. A
preference of the Host's, not a client's: every client draws the same hero.
_Avoid_: pinned catalog, top shelf, hero row

**Discover**:
The one feed of Discovered Titles a client browses that is not an Addon's: the
page TMDB offers, asked for by TMDB's own filters (type, genre, sort, page)
rather than a Catalog's declared `extra`. It needs a TMDB Credential; with none
it is a screen that says so rather than a hidden one.
_Avoid_: TMDB catalog, discover catalog

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
TMDB key and the Stremio `authKey` today. It lives in the secret store, is read at
the moment of use, and never enters Host state or a Snapshot.
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

**Account sync** (or **Stremio sync**):
Optional, bidirectional reconciliation between the Host's Watch progress and a
personal Stremio account. Remote progress newer than local records is pulled on
open; local progress is pushed on pause, stop, and exit. Conflicts resolve by
timestamp, and per-episode watched bitfields are merged without clobbering
positions. It does not sync Library membership — that is not built.
_Avoid_: backup, cloud storage

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
The resume state the Host stores for a Video: how far into it the owner got,
how long it is, and whether it counts as watched. Recorded while it plays, so it
outlives a Host that was killed rather than stopped.
_Avoid_: progress (unqualified), history

**Continue watching**:
The row a client draws from the Host's Watch progress — one card per Video, most
recently played first — and the first row of a client's Home. It is drawn from
the Host's own record, so every client shows the same row. Real and offline: it
needs no account and no network, and an entry whose Addon is gone stays listed,
marked unplayable.
_Avoid_: library, history, watchlist, resume

**Library**:
The collection of Titles held in the owner's Stremio account. Its *membership* —
what is saved to the account and removed from it, and the sync that would carry
it — is not built: nothing stores it today, and a client's Library screen is a
stub until something does. Account sync reconciles Watch progress, not membership.
_Avoid_: history, watchlist, collection, continue watching

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
is not drawn. Never a setting of the Host's: a control a client takes, or what
the Autocrop control asks the stock script to find.
_Avoid_: zoom, pan, letterbox

**Autocrop**:
The Player finding the picture's black bars and cropping to them, or restoring
the full frame when asked again: a control a client takes, never something that
happens on its own. What it finds is a **Crop** like any other.
_Avoid_: auto-crop, zoom, fit

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

**Subtitle appearance**:
The colour and size the Player draws subtitles in, a preference of the Host's
beside the subtitle language: the same on every Stream and every client. The
colour reaches subtitles that leave the colour open, so an ASS track keeps the
colour it was authored with; the size reaches both kinds of subtitle (ADR-0024).
_Avoid_: subtitle style, caption settings, theme, styling

### Remote clients

**Remote client**:
A client on another machine that reaches the Host's Action surface over the wire
— the equal of the Host's own window, not a cut-down one. It is a browser the
Host serves, paired to that device alone.
_Avoid_: phone app, second screen, companion

**Cast Remote**:
The three-surface shape the served Remote client is drawn in: the six-destination
browse surface with the docked strip, the expanded full-screen remote the strip
opens, and the Audio & Subtitles sheet over it. It is a way the Remote client is
drawn, not a second client.
_Avoid_: companion, remote app

**Pairing code**:
The short code the Host shows, which a client redeems once for a Device token.
Single-use: redeeming it rotates the one the Host shows. Not a password, and not
stored.
_Avoid_: PIN, passcode, QR

**Device**:
A client that has paired, known by a name and when it paired, and revocable on
its own without disturbing the others. What the Host keeps of it is the digest of
its token, never the token.
_Avoid_: client (unqualified), session, peer

**Device token**:
The long-lived secret a Device was issued and presents on every frame, which is
what "this device has paired" means. Revoking the Device is what stops it working.
_Avoid_: key, session id, credential

