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
library state. Most Snapshots are the state a Change made; a background cache
write that moves **Continue watching** publishes one too, without an Action
having asked, because the row every client draws is shared state (#274, #277).
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
later report carries it — and is published like any other. A **look hint** is a
Change whose only effect is the Host's own background queue: it answers nobody,
publishes no Snapshot and moves no revision (#278). (The resolved state
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
TorBox) are others.
_Avoid_: source, backend, resolver

**Stream**:
A candidate a Provider returns for a Video: either a direct URL that can be
played immediately, or a torrent — an infoHash, and which file in it — that the
Torrent engine turns into bytes first. A magnet link is a torrent too.
_Avoid_: source, link, result

**Torrent engine**:
The Host's seam between a chosen torrent Stream and the Player: it joins the
torrent's swarm from the owner's own address, uploads included, and serves the
file asked for to the Player. A program shipped with the Host and started by it
on the first torrent played; it lives only as long as the Host does. Not a
Provider: it answers for no Video.
_Avoid_: bridge, sidecar, torrent client, server

**Streams picker**:
The list of Streams a Video can be played as — one group per Addon that answered,
in the Host's order — which a client draws and a person chooses from. Pressing an
episode opens it; **Play** opens it instead of playing directly when continuity
finds no Stream or the owner's preference says so (#276).
_Avoid_: stream list, source list, results

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
beside the video and never receives the picture itself. The only frames that
cross this seam are a Seek preview, asked for at one moment and never at the
frame rate (ADR-0028).
_Avoid_: mpv (for the seam), backend, engine, renderer. The Player is never
called an engine, and "Torrent engine" is always qualified.

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
The row a client draws from the Host's Watch progress — one card per Title, most
recently played first — and the first row of a client's Home. A series' card is
the Video of it played last, or its Up next once that Video is finished; a Title
whose card would be a finished Video with nothing after it leaves the row,
though its Watch progress stays. A card opens its Title. It is drawn from the
Host's own record, so every client shows the same row. Real and offline: it
needs no account and no network, and an entry whose Addon is gone stays listed,
marked unplayable.
_Avoid_: library, history, watchlist, resume

**Up next**:
The Video a series' Continue watching card moves on to once the Video played
last is finished: the one after it in the Title's own list of Videos, specials
apart — a season's finale leads into the next season, the series' last
numbered episode has no Up next, and a special's Up next is the special after
it. An Up next already partly watched is resumed like any other
card. A series caught up with nothing listed after its last Video leaves the row
and comes back when its Up next is listed, aired or not. A Title opened anywhere
is anchored on its card's Video — Up next included — and a Title with no card
opens at its beginning.
_Avoid_: next episode (that is the Action that steps playback)

**Up next playback**:
Whether pressing **Play** on a Title's Up next opens its Stream straight away by
continuity or opens the Streams picker first: a preference of the Host's, shared
by every client (#276). Orthogonal to **Autoplay** — it governs only Play on
an Up next card, never what happens when an episode ends or Resume.

**Autoplay**:
Whether the Host advances on its own to a Title's Up next after a short
countdown when an episode's Stream ends, or waits on the ended state until
someone asks: a preference of the Host's, shown in Settings and in the player on
every client (#302, #314). Orthogonal to **Up next playback** — Autoplay
advances by `next_episode`'s continuity and never opens the picker because of Up
next playback; the picker opens only when continuity finds no Stream. After
three episodes in a row that nobody touched, it holds on **Still watching?**
instead of counting down (#319).

**Still watching?**:
Autoplay's hold after three auto-advances in a row with nobody touching
anything: the Host publishes `unattended_limit` for the episode it would have
played, with no countdown, and only a play — **Keep watching** — moves on.
Pausing, seeking, changing the volume or any other Change from a client counts as
being there and starts the count again (#319, ADR-0040).

**Library**:
The collection of Titles held in the owner's Stremio account. The room reads the
account's collection and is read-only: its *membership* — what is saved to the
account and removed from it, and the sync that would carry those writes — is not
built. One item is one Title, not one Video: a series carries its current episode
and its watched episodes in that item. Account sync reconciles Watch progress,
not membership.
_Avoid_: history, watchlist, collection, continue watching

**Playback position**:
How far into the Stream playing now the Host is, in seconds: the Host's own
record, moved at the moment of a control and corrected by the Player's next
report.
_Avoid_: progress, timestamp

**Buffered**:
How much of the Stream the Player has actually read, as a span of Playback
positions: where the read begins — the Stream's own start while the whole head
is held, otherwise the start of the range it can still be seeked within — and
how far it has reached. A reading and not a preference: what the Player *may*
read ahead is the Stream buffer, which bounds this. A client draws it behind its
progress bar, so a seek into the span's gap is a seek into bytes that are not
there yet.
_Avoid_: cache, loaded, downloaded

**Seek preview**:
The still of one moment of the Stream, asked for by a client pointing at its
timeline and drawn above the bar: a frame the Player yields *about* the Stream,
not a piece of the picture it is drawing. The one kind of frame that crosses the
Player seam (ADR-0028). Absent where the Player cannot say, and drawn as absent:
a client then shows the time and the Chapter instead.
_Avoid_: thumbnail, sprite, storyboard, scrub image

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

**Pending**:
A client's own state between pressing a control and the Host's answer: the
Action is in flight, the control draws the wait, and a second identical press is
dropped. Never in a Snapshot — it is a fact about this client's request, not
about the Host — and two relative steps (two rewinds, two chapter steps) are two
steps, never collapsed into one (ADR-0027).
_Avoid_: busy, loading, spinner (for the state)

**Subtitle languages**:
An ordered list of up to three languages the Host chooses a Stream's subtitle
Track by, first the most wanted: a preference of the Host's, the same on every
client. Empty, it follows the file (ADR-0041).
_Avoid_: subtitle language (singular), slang, caption language

**Audio languages**:
The same, for the soundtrack. Independent of Subtitle languages; neither is
derived from the other (ADR-0041).
_Avoid_: audio language (singular), alang, dub preference

**Hand pick**:
A Track a client selected during playback, kept as a language (or as "off")
while the Title keeps playing, ahead of the lists. It ends on stop, on playing
another Title, and on a Host restart. It is never stored, and it never changes
the lists.
_Avoid_: override, manual track, sticky track

**Follow the file** (under Subtitle languages):
The phrase for an empty list, in this glossary and in Settings: the Host takes
the subtitle or soundtrack the file itself marks as default, and chooses by no
language. It replaces "Host picks per Video".
_Avoid_: Host picks per Video, auto, default language

**Subtitle appearance**:
The colour and size the Player draws subtitles in, a preference of the Host's
beside the Subtitle languages: the same on every Stream and every client. The
colour reaches subtitles that leave the colour open, so an ASS track keeps the
colour it was authored with; the size reaches both kinds of subtitle (ADR-0024).
_Avoid_: subtitle style, caption settings, theme, styling

**Stream buffer**:
How much of a Stream the Player keeps read ahead of where it is playing — how
many seconds it aims for and how much memory that read-ahead may take — so a dip
in the network is ridden out instead of interrupting playback. A preference of
the Host's, not a client's, and the same on every Stream: it ends where either
limit is reached first (ADR-0026). For a torrent Stream, it also sets how far
ahead the Torrent engine fetches.
_Avoid_: cache (the Host already caches Addon pages), preload, buffer size

**Torrent cache**:
The most disk a held torrent may take while it plays: pieces furthest behind
playback are given up first, and all of it is deleted when the torrent is let go.
A preference of the Host's, set once for every torrent.
_Avoid_: download, torrent storage, disk buffer

**Stalled**:
A Stream that is playing, paused by no one, and held because the bytes ahead of it
have not arrived yet. True of any Stream, direct or torrent; a Stream still
opening is not Stalled, it is opening.
_Avoid_: buffering, loading, frozen

**Torrent status**:
What the Torrent engine reports about the torrent being played: whether it is
still finding the torrent or fetching it, how many peers it is connected to, and
how fast bytes arrive. Never which torrent. Absent for a direct Stream.
_Avoid_: swarm info, health, torrent stats

### Clients

**Level**:
A surface a client pushes above what it was showing — a Title, the Streams of
one, a settings category, a confirm — and pops one at a time with Back. A Level
is client-side only: it moves nothing on the Host and is not shared between
devices (ADR-0005).
_Avoid_: screen, page, route, modal

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

