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

**Video**:
One playable unit of a Title: the film itself, or a single episode. Watch
progress is recorded against a Video.
_Avoid_: episode (for films), media, stream

### Sources

**Addon**:
A service the Host is configured with that speaks the Stremio addon protocol.
_Avoid_: plugin, extension, provider

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

### Playback

**Watch progress**:
The resume state the Host stores for a Video.
_Avoid_: progress (unqualified), history

**Playback position**:
How far into the currently playing media the Host is, in seconds.
_Avoid_: progress, timestamp
