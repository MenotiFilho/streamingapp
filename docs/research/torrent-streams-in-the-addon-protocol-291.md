# What the addon protocol says about a torrent Stream (#291)

**Date of research:** 2026-11-16. **Where:** primary sources only — the official Stremio addon protocol docs and types (`Stremio/stremio-addon-sdk`), validator (`Stremio/stremio-addon-linter`), client core (`Stremio/stremio-core`), video/streaming bridge (`Stremio/stremio-video`), torrent engine (`Stremio/enginefs`), web UI (`Stremio/stremio-web`), Torrentio's source (`TheBeastLT/torrentio-scraper`), live checks against `https://torrentio.strem.fun` (`live_check` + HTTP JSON key-presence audit), and this repo's recorded fixtures and Host code. No design decisions — facts and their source links, closing with the concrete fields and file-choice rules that #294 / #12 must account for.

Issue #291, child of map #283, blocking #294. Read with `CONTEXT.md` (*Host*, *Addon*, *Manifest*, *Provider*, *Stream*, *Streams picker*, *Video*, *Player*, *Now playing*), ADR-0012 (`docs/adr/0012-choosing-a-stream-the-provider-seam.md`), and `docs/research/stream-url-refusal-249.md`.

## Sources

| Source | URL / Path | What it grounds |
|---|---|---|
| SDK Stream response spec | <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/stream.md> | Documented torrent fields, `sources`, `fileMustInclude`, `behaviorHints` |
| SDK Manifest response spec | <https://github.com/Stremio/stremio-addon-sdk/blob/master/docs/api/responses/manifest.md> | `manifest.behaviorHints.p2p` placement |
| SDK TypeScript declarations | <https://github.com/Stremio/stremio-addon-sdk/blob/master/src/types.d.ts> | Canonical SDK `Stream` / `StreamBehaviorHints` types |
| SDK HTTP router | <https://github.com/Stremio/stremio-addon-sdk/blob/master/src/getRouter.js> | Runtime `behaviorHints.filename` warning on `stream.url` |
| Addon linter | <https://github.com/Stremio/stremio-addon-linter/blob/master/lib/linter.js> | `manifest.behaviorHints` vs `stream` validation |
| `stremio-core` Stream type | <https://github.com/Stremio/stremio-core/blob/master/src/types/resource/stream.rs> | `StreamSource::Torrent`, `announce` / `sources` alias, `magnet_url()` |
| `stremio-core` StreamingServer model | <https://github.com/Stremio/stremio-core/blob/master/src/models/streaming_server.rs> | `/{infoHash}/create` calls and `magnet:` / `.torrent` creation |
| `stremio-core` DeepLinks | <https://github.com/Stremio/stremio-core/blob/master/src/deep_links/mod.rs> | `ExternalPlayerLink` (`magnet`, `streaming`, `openPlayer`) |
| `stremio-video` streaming server adapter | <https://github.com/Stremio/stremio-video/blob/master/src/withStreamingServer/withStreamingServer.js> | `/hlsv2/probe`, `/hlsv2/{id}/master.m3u8`, player stream handoff |
| `stremio-video` `convertStream` | <https://github.com/Stremio/stremio-video/blob/master/src/withStreamingServer/convertStream.js> | `magnet:` in `stream.url`, `stream.announce`, pre-computed URLs |
| `stremio-video` `createTorrent` | <https://github.com/Stremio/stremio-video/blob/master/src/withStreamingServer/createTorrent.js> | `POST /{infoHash}/create`, `peerSearch`, `guessFileIdx`, `?tr=` URL |
| `stremio-video` `fetchVideoParams` | <https://github.com/Stremio/stremio-video/blob/master/src/withStreamingServer/fetchVideoParams.js> | `/{infoHash}/stats.json` fallback filename selection |
| `stremio-video` `ShellVideo` | <https://github.com/Stremio/stremio-video/blob/master/src/ShellVideo/ShellVideo.js> | What desktop `mpv` actually receives (`loadfile <url>`) |
| `enginefs` HTTP server & engine | <https://github.com/Stremio/enginefs/blob/master/enginefs.js> | HTTP endpoints, byte-range serving, `fileMustInclude`, `peerSearch` defaults |
| `enginefs` `GuessFileIdx` | <https://github.com/Stremio/enginefs/blob/master/lib/guessFileIdx.js> | Absent-`fileIdx` media filtering, episode match, largest-file selection |
| `stremio-web` `Stream.tsx` & `useStreamPlay.ts` | <https://github.com/Stremio/stremio-web/blob/development/src/routes/Details/Streams/Stream.tsx> | `externalUrl` browser open, "Copy magnet link" menu |
| `torrentio-scraper` domain & magnet | <https://github.com/TheBeastLT/torrentio-scraper/blob/master/addon/crates/addon/src/domain/stream_info.rs> | How Torrentio emits `fileIdx`, `filename`, `sources`, `title` |
| This Host | `crates/host-core/src/stream.rs`, `addon.rs`, `provider.rs`, `playback.rs` | What this Host reads, ignores, and refuses today |
| Recorded fixtures & ADR | `crates/host-core/tests/fixtures/*.json`, `docs/adr/0012-choosing-a-stream-the-provider-seam.md`, `docs/research/stream-url-refusal-249.md` | Saved Torrentio/WatchHub payloads and Host architecture |

---

## 0. Summary in one paragraph

In the Stremio addon protocol, a torrent `Stream` is identified by a 40-character hex `infoHash` with optional 0-based `fileIdx` and optional `sources` (`tracker:<url>` and `dht:<node/hash>` entries). The official Rust client core (`stremio-core`) accepts both `sources` and `announce` on deserialization (serializing out as `announce`), rejects `infoHash` values that are not 20-byte strict hex, and treats `p2p` as a `Manifest`-level hint rather than a documented `Stream` hint. When `fileIdx` is omitted — which happens in **39.2% of movie items (196/500)** and **4.3% of series items (12/281)** on live Torrentio — Stremio's `enginefs` chooses the largest media file by byte size, narrowing first by parsed season and episode when the `Video` is a series episode (unless `fileMustInclude` regexes override it). `magnet:` links arrive officially by synthesizing `magnet:?xt=urn:btih:…` client-side from `infoHash` + `sources`, though `stremio-core` and `stremio-video` also accept `magnet:` inside `stream.url` (not inside `externalUrl`, which is strictly an external browser webpage). To play a torrent, Stremio's client hands `enginefs` the `infoHash` and trackers via `POST /{infoHash}/create` (when `sources` exist or `fileIdx` is missing) and passes the resulting local byte-range HTTP URL (`http://127.0.0.1:11470/{infoHash}/{fileIdx}[?tr=…]`) directly to `mpv` on desktop or via `/hlsv2/probe` in a browser. Today this Host reads `infoHash`, `behaviorHints.filename`, and `behaviorHints.bingeGroup`, drops `fileIdx`, `sources`, `announce`, `videoSize`, and `manifest.behaviorHints.p2p`, refuses `Playback::InfoHash` as unplayable (#12), and lists `url: "magnet:..."` as `Playback::Direct` only to refuse it on play (#249).

---

## 1. Torrent fields in the addon protocol (`stremio-addon-sdk` vs `stremio-core`)

`stremio-addon-sdk` (`docs/api/responses/stream.md` and `src/types.d.ts`) specifies that **"One of the following must be passed"** to locate a stream's bytes (`url`, `ytId`, `infoHash`, `nzbUrl`, `rarUrls`, `zipUrls`, `7zipUrls`, `tgzUrls`, `tarUrls`, `externalUrl`). For torrents:

| Field | `stremio-addon-sdk` (`stream.md` / `types.d.ts`) | `stremio-core` (`stream.rs`) | Notes |
|---|---|---|---|
| `infoHash` | Required for torrent stream: string, info hash of torrent file | `#[serde(with = "SerHex::<Strict>")] info_hash: [u8; 20]` | Must be valid 40-char hex (20 bytes); lowercase/uppercase normalized to lowercase hex in `enginefs` & `stremio-video` |
| `fileIdx` | Optional number: 0-based index of video file inside the torrent | `file_idx: Option<u16>` | If omitted, protocol specifies largest file in the torrent is selected (§2) |
| `sources` | Optional `string[]`: `"tracker:<protocol>://<host>:<port>"` (`http` or `udp`) and `"dht:<node_id/info_hash>"` | Accepted via `#[serde(default, alias = "sources")] announce: Vec<String>` (`DefaultOnNull`) | SDK warns DHT use may be prohibited by private trackers (`enginefs` default still injects `dht:<infoHash>`, §5) |
| `announce` | **Not documented** in `stream.md`, `types.d.ts`, or `stremio-addon-linter` | Primary struct field name (`announce: Vec<String>`) serialized over JS bridge | Because `stremio-core` serializes as `announce`, `stremio-video`'s `convertStream.js` reads `stream.announce` rather than `stream.sources` |
| `fileMustInclude` | Documented as regex string for NZB/archives only: *"(not supported for torrents yet)"* | Not modeled on `StreamSource::Torrent` | **Contradiction in implementation:** `enginefs` actually implements `fileMustInclude` for torrents via `POST /{infoHash}/create` and `?f=` query param (§2) |

### `behaviorHints` relevant to torrents

`stremio-addon-sdk`'s `stream.md` and `src/types.d.ts` define seven `stream.behaviorHints` properties (`countryWhitelist`, `notWebReady`, `bingeGroup`, `proxyHeaders`, `videoHash`, `videoSize`, `filename`). Four relate to torrent streams or P2P handling:

1. **`filename`** (`string`, optional): Name of the video file, passed to subtitle Addons. `stream.md` and `src/getRouter.js` warn when `stream.url` omits `filename` (not when `infoHash` omits it, because the client can query `enginefs` `/{infoHash}/stats.json` — `fetchVideoParams.js`). Real torrent Addons (Torrentio) still populate `behaviorHints.filename` on `infoHash` streams whenever `fileIdx` is known.
2. **`videoSize`** (`number`, optional): Size of the video file in bytes; passed to subtitle Addons to match subtitles (OpenSubtitles file size matching). Neither `stremio-core::StreamBehaviorHints` nor Torrentio's live P2P output uses it for file selection or playback (it sits in `stremio-core`'s `other: HashMap<String, Value>`).
3. **`bingeGroup`** (`string`, optional; replaces deprecated `group`): Identifies streams belonging to the same release/encoder group so consecutive episodes auto-select a matching Stream across requests.
4. **`p2p`** (`boolean`, optional — **placement mismatch**):
   - In `stremio-addon-sdk` (`docs/api/responses/manifest.md`) and `stremio-addon-linter` (`lib/linter.js`), `p2p` is a **`Manifest`-level** `behaviorHints` flag (`['adult', 'configurable', 'configurationRequired', 'p2p']`).
   - `p2p` does **not** appear on `stream.behaviorHints` in `stream.md`, `src/types.d.ts`, or `stremio-core::StreamBehaviorHints` (any `p2p` key on a `Stream` lands in `other: HashMap<String, Value>`).
   - Conversely, this Host reads `behaviorHints.p2p` only on `Stream` (`crates/host-core/src/stream.rs`) and ignores `p2p` on `Manifest` (`crates/host-core/src/addon.rs`).

Note also `videoHash` (`string`, optional): OpenSubtitles hash sent to subtitle Addons when a streaming server is unavailable to compute `/opensubHash?videoUrl=…` locally.

---

## 2. What happens when `fileIdx` is absent

`stream.md` states the rule briefly: *"if `fileIdx` is not specified, the largest file in the torrent will be selected"*. In practice, the official stack resolves an absent `fileIdx` across `stremio-video` and `enginefs` as follows:

1. **Client dispatch (`Stremio/stremio-video/src/withStreamingServer/createTorrent.js`)**:
   - When `fileIdx === null || !isFinite(fileIdx)`, `createTorrent` sets `body.guessFileIdx = {}`, adding `season` and `episode` if `seriesInfo` provides finite numbers, and `POST`s to `/{infoHash}/create`.
   - `createTorrent` then reads `resp.guessedFileIdx` from the JSON response and constructs `/{infoHash}/{guessedFileIdx}[?tr=…]`.
   - If `fileIdx` *is* present and `sources` is empty, `createTorrent` skips `POST /{infoHash}/create` and builds `/{infoHash}/{fileIdx}` directly (leaving `enginefs` to initialize lazily on `GET`).
2. **Engine file choice (`Stremio/enginefs/enginefs.js` and `lib/guessFileIdx.js`)**:
   - **Regex override first**: Both `POST /{infoHash}/create` (`body.fileMustInclude`) and `openPath` (`?f=` query param) check `parseFileMustInclude(...)` with `safe-stateless-regex` (500 ms timeout) against `file.name`. If any regex matches, the first matching file index becomes `guessedFileIdx` (in `/create`) or overrides `fileIdx` (in `openPath`).
   - **Media extension filter (`GuessFileIdx`)**: Filters torrent files where `file.path` matches:
     ```js
     /\.(mkv|avi|mp4|wmv|vp8|mov|mpg|ts|m3u8|webm|flac|mp3|wav|wma|aac|ogg)$/i
     ```
     (Notably includes audio extensions; returns `-1` if no file matches.)
   - **Episode match (series only)**: If `seriesInfo` has truthy `season` and `episode`, runs `video-name-parser` (`parseVideoName(file.path)`) and keeps matches where `info.season === seriesInfo.season && Array.isArray(info.episode) && info.episode.includes(seriesInfo.episode)`.
   - **Largest-file pick**: From the episode-matched subset (if non-empty) or else all extension-matched media files, picks the single file with the largest `file.length`.
   - **Path fallback if `GET` arrives directly without `fileIdx` or `/create`**: In `openPath`, `parts[1]` defaults to `-1`, triggering `GuessFileIdx(engineStats.files, {})` with empty `seriesInfo` (largest media file, no episode matching). If `parts[1]` is non-numeric (`isNaN(i)`), `enginefs` matches `decodeURIComponent(parts[1]) === file.name`.
3. **Filename lookup for subtitles (`Stremio/stremio-video/src/withStreamingServer/fetchVideoParams.js`)**:
   - When `infoHash` is known and `fileIdx` is missing or `-1`, `fetchFilename` queries `GET /{infoHash}/stats.json`, prefers `stats.files[stats.guessedFileIdx].name`, and otherwise falls back to the largest file matching video-only extensions `/\.(mp4|mkv|avi|mov|wmv|flv|webm|m4v|mpg|mpeg|ts|m2ts)$/i` (or any file).

---

## 3. How `magnet:` reaches a client in practice

1. **Synthesized from `infoHash` (canonical Addon protocol path)**:
   - Addons send `infoHash` (+ optional `fileIdx` and `sources`), never a `magnet:` URI.
   - `stremio-core` (`Stream::magnet_url()` in `src/types/resource/stream.rs`) builds `Magnet { xt: hex::encode(info_hash), hash_type: "btih", dn: stream.name, tr: ... }` from `StreamSource::Torrent`, keeping only `announce` entries prefixed with `tracker:` (stripping `"tracker:"`) and dropping `dht:` entries.
   - `stremio-core`'s `ExternalPlayerLink::from(&Stream)` (`src/deep_links/mod.rs`) exposes this as `externalPlayer.magnet`, which `stremio-web` (`Stream.tsx`) renders as the **"Copy magnet link"** context menu action.
2. **Inside `stream.url` (undocumented, actively supported by official stack)**:
   - `stream.md` documents `url` only as an `http(s)/ftp(s)/rtmp` link.
   - However, `stremio-core::StreamSource::Url { url: Url }` parses any valid RFC URL including `magnet:`, and `ExternalPlayerLink` explicitly checks `if url.scheme() == "magnet"` to expose it as `magnet` (and not as a direct HTTP streaming/download link).
   - `stremio-video`'s `convertStream.js` explicitly handles `stream.url.indexOf('magnet:') === 0`: it decodes the magnet with `magnet-uri`, converts `parsedMagnetURI.announce` to `tracker:<url>`, and calls `createTorrent(streamingServerURL, infoHash, null, sources, seriesInfo)` — always with `fileIdx = null` (`guessFileIdx`).
   - Desktop Stremio shells also pass user-opened `magnet:` links / `.torrent` files directly to `stremio-core`'s `StreamingServer::CreateTorrent` (`streaming_server.rs`), which parses the magnet and `POST`s `/{infoHash}/create` with `peerSearch`.
3. **Inside `externalUrl` (not a torrent path)**:
   - `stream.md` defines `externalUrl` as a link to an external webpage to open in a browser (e.g. WatchHub streaming service links).
   - `stremio-core` parses it into `StreamSource::External`, and `stremio-web` (`useStreamPlay.ts`) opens `externalPlayer.web` with `target="_blank"`. Neither `stremio-core` nor `stremio-video` sends `externalUrl` to `enginefs` or treats it as a torrent.

---

## 4. What real Addons send (field presence, not content)

### Recorded fixtures under `crates/host-core/tests/fixtures/`

| Fixture | Items | Top-level keys present | `behaviorHints` keys present | `sources` prefixes |
|---|---|---|---|---|
| `torrentio-streams-matrix.json` | 5 | `name` (5), `title` (5), `infoHash` (5), `fileIdx` (4 — **absent on 1**), `behaviorHints` (5), `sources` (1) | `bingeGroup` (5), `filename` (4 — tracks `fileIdx`) | `tracker` (1), `dht` (1) |
| `torrentio-streams-bb-s1e1.json` | 3 | `name` (3), `title` (3), `infoHash` (3), `fileIdx` (3), `behaviorHints` (3), `sources` (1) | `bingeGroup` (3), `filename` (3) | `tracker` (1), `dht` (1) |
| `streams-with-a-bad-item.json` | 4 | Includes 2 `infoHash` items (`name` + `infoHash`, 1 also has `title`) | none | none |
| `torrentio-manifest.json` | — | Manifest `behaviorHints`: `{ configurable: true, configurationRequired: false }` (no `p2p`) | — | — |
| `aiostreams-manifest.json` | — | Manifest `behaviorHints`: `{ configurable: true, configurationRequired: true }` (no `p2p`) | — | — |

### Live checks (`live_check` + live HTTP field-presence audit, 2026-11-16)

Running `docker compose run --rm dev cargo run --bin live_check` against `https://torrentio.strem.fun/manifest.json` (`com.stremio.torrentio.addon v0.0.15`):

- `manifest`: `ok` (`behaviorHints: { configurable: true, configurationRequired: false }`, **no `p2p`**)
- `stream movie/tt0133093`: `ok (500 items)`
- `stream series/tt0903747`: `ok (500 items)` (`live_check` asks episode 1 of series; direct HTTP audit of `series/tt0903747:1:1.json` returned 281 items)

Direct HTTP key-presence counts across those live Torrentio responses:

| Endpoint | Total items | `name` | `title` | `description` | `infoHash` | `fileIdx` | `sources` | `announce` | `behaviorHints` |
|---|---|---|---|---|---|---|---|---|---|
| `movie/tt0133093` | 500 | 500 | 500 | 0 | 500 | **304** (196 absent) | **71** (`tracker`: 1855, `dht`: 71) | 0 | 440 (`bingeGroup`: 426, `filename`: **304**) |
| `series/tt0903747:1:1` | 281 | 281 | 281 | 0 | 281 | **269** (12 absent) | **52** (`tracker`: 1368, `dht`: 52) | 0 | 277 (`bingeGroup`: 275, `filename`: **269**) |

Also probed on 2026-11-16: `comet.elfhosted.com` (`manifest.json` `HTTP 200`, `stream/movie/tt0133093.json` `HTTP 403` unconfigured), `mediafusion.elfhosted.com` (`manifest.json` `HTTP 200`, `stream/movie/tt0133093.json` `HTTP 200` with `0` streams unconfigured), and `thepiratebay-plus.strem.fun` (DNS `Name or service not known`).

Checking Torrentio's source (`TheBeastLT/torrentio-scraper`, `addon/crates/addon/src/domain/stream_info.rs` and `infrastructure/magnet.rs`) confirms **why** `fileIdx` and `filename` match 1:1 in live responses:

- `to_stream_info` sets `filename = record.file_index.map(|_| record.title.rsplit('/').next()...)`, so whenever the scraper lacks a resolved per-file index (`file_index: None`), it omits **both** `fileIdx` and `behaviorHints.filename`.
- `to_stream_info` always populates deprecated `title` (never `description`), omits `videoSize` and `videoHash` on P2P torrent streams (even though `BehaviorHints` in `domain/stream.rs` has fields for them), never emits `behaviorHints.p2p` on either `Stream` or `Manifest`, and only attaches `sources` (`tracker:<url>` list plus `"dht:" + info_hash`) when tracker data exists or `enrich_stream_sources` injects anime/Russian trackers.

---

## 5. How the official stack plays a torrent

Stremio runs a local HTTP bridge (`stremio-server` wrapping `enginefs`, default base `http://127.0.0.1:11470`):

### Local HTTP endpoints (`enginefs.js`)

- **`POST /{infoHash}/create`** (or `ALL /{infoHash}/create`):
  - Body (`stremio-video/src/withStreamingServer/createTorrent.js`):
    ```json
    {
      "torrent": { "infoHash": "<40-hex>" },
      "peerSearch": { "sources": ["dht:<ih>", "tracker:..."], "min": 40, "max": 200 },
      "guessFileIdx": { "season": 1, "episode": 1 }
    }
    ```
    (`guessFileIdx` is `false` when `fileIdx` is provided; `peerSearch` is omitted when `sources` is empty, in which case `enginefs` defaults to `sources: ["dht:" + infoHash]`, `min: 40`, `max: 200`.)
  - Optional `body.fileMustInclude` regex array overrides `guessFileIdx`.
  - Returns JSON statistics including `files` (name/path/length) and `guessedFileIdx`.
- **`GET /{infoHash}/{idx}`** (also `/{infoHash}/{idx}/*`, query `?tr=<source>&tr=…&f=<regex>&download=1&external=1`):
  - Lazily starts the torrent engine if `/create` was skipped; resolves `-1`, filename, or `?f=` via `openPath`; prewarms piece selection on open-ended `Range: …-` requests.
  - Serves `200 OK` (full length) or `206 Partial Content` / `416 Range Not Satisfiable` with `Accept-Ranges: bytes`, `Content-Type` from `mime.lookup(handle.name)`, `Content-Length`, `Cache-Control: max-age=0, no-cache`, CORS, and DLNA headers.
- **`GET /{infoHash}/stats.json`** and **`GET /{infoHash}/{idx}/stats.json`**: Swarm/peer counts, download/upload speeds, `files`, `guessedFileIdx`, `selections`.
- **`GET /{infoHash}/remove`** and **`GET /removeAll`**: Tears down torrent engine(s).
- **`POST /create`**: Creates an engine from a `.torrent` file path, HTTP URL (`from`), or hex blob (`blob`).
- **HLSv2 & subtitle helpers** (handled by `stremio-server` / `withStreamingServer.js`): `/hlsv2/probe?mediaURL=…`, `/hlsv2/{id}/master.m3u8?mediaURL=…`, `/opensubHash?videoUrl=…`, `/subtitles.vtt?from=…`.

### What the player is given (`withStreamingServer.js` + `ShellVideo.js`)

- **Desktop shell (`ShellVideo`, backed by `mpv`)**: `ShellVideo.canPlayStream` unconditionally returns `true` (`ShellVideo.js`), so `withStreamingServer.js` hands `mpv` the local HTTP byte-range URL `http://127.0.0.1:11470/{infoHash}/{fileIdx}[?tr=…]` directly via `mpv-command: ["loadfile", stream.url, ...]` with no HLS transcoding.
- **Browser (`HTMLVideo`)**: `withStreamingServer.js` probes `/hlsv2/probe?mediaURL=<encoded_local_url>`; if the browser cannot play the container/codecs directly, it rewrites the player URL to `/hlsv2/{id}/master.m3u8?mediaURL=<encoded_local_url>`.
- **External player (`stremio-core` `ExternalPlayerLink::from`)**: Exposes the local HTTP `streaming` URL (when streaming server base URL is ready), synthesized `magnet`, M3U `playlist`, and OS-specific `openPlayer` deep links.

---

## 6. What this Host already reads and drops

| Layer | File | What it reads / accepts today | What it drops / refuses today |
|---|---|---|---|
| Stream parser | `crates/host-core/src/stream.rs` | Enforces **exactly one** non-empty location across `LOCATIONS` (`url`, `ytId`, `infoHash`, `externalUrl`, `nzbUrl`, `rarUrls`, `zipUrls`, `7zipUrls`, `tgzUrls`, `tarUrls`). Emits `Playback::Direct { url }` or `Playback::InfoHash { info_hash }`. Reads `name`, `description` (fallback `title`), `behaviorHints.notWebReady`, `behaviorHints.p2p`, `behaviorHints.proxyHeaders`, `behaviorHints.filename`, `behaviorHints.bingeGroup`. | **Drops** `fileIdx`, `sources`, `announce`, `subtitles`, `fileMustInclude`, `behaviorHints.videoSize`, `behaviorHints.videoHash`, `behaviorHints.countryWhitelist`, and all non-`url`/non-`infoHash` locations (`ytId`, `externalUrl`, `nzbUrl`, archives). Does not validate that `infoHash` is 40-char hex or inspect `url` scheme (`magnet:` becomes `Playback::Direct`). |
| Manifest parser | `crates/host-core/src/addon.rs` | Reads `behaviorHints.configurable` and `behaviorHints.configurationRequired`. | **Drops** `manifest.behaviorHints.p2p` (where the addon protocol puts the P2P flag). |
| Provider seam | `crates/host-core/src/provider.rs` & ADR-0012 | Separates fetching/parsing (`AddonProvider`) from Host rules via `Stream` (`Playback::Direct` vs `Playback::InfoHash`), keeping `Stream` expressible before #12's torrent bridge exists. | `Playback::InfoHash` carries only `info_hash: String` — no `file_idx`, no `sources`/`announce`. |
| Playback validation | `crates/host-core/src/playback.rs` & `docs/research/stream-url-refusal-249.md` | `ChosenStream::parse` resolves `Playback::Direct` through `StreamUrl::parse` (`http`/`https` with host, up to `MAX_STRING_LEN`). | Refuses `Playback::InfoHash` as `ActionError::Unplayable` (*"the bridge that would is #12"*). Refuses non-`http(s)` URLs (including `magnet:` in `stream.url`) only at Play time, leaving them unmarked in the Streams picker (`#249`). |

### Concrete inputs for #294 / #12

1. **Fields the Host must start reading**:
   - **`fileIdx`** (optional non-negative integer, `Option<u16>` / `Option<usize>`): Present on ~61% of movie candidates and ~96% of series candidates from Torrentio; required to pick the target file inside multi-file torrents without guessing.
   - **`sources`** (optional `Vec<String>`, accepting `announce` as an alias as `stremio-core` does): Contains `tracker:<url>` and `dht:<node/hash>` entries; essential for torrents without DHT or with non-default trackers, and needed if the Host chooses to respect private-tracker opt-outs from DHT.
   - **`magnet:` in `stream.url`** (decision required): Because `StreamUrl::parse` rejects non-`http(s)` at Play time (#249), #294/#12 must decide whether `Stream::parse` parses `url: "magnet:..."` into the torrent `Playback` shape (`info_hash` + `tr=` trackers as `sources`, `file_idx: None`) or rejects non-`http(s)` `url`s at parse time so unplayable entries do not appear unmarked in the Streams picker.
   - **Validation & secondary hints to review**: Validate `infoHash` format (40 hex chars, case-insensitive) or normalize on parse; reconcile `manifest.behaviorHints.p2p` (`addon.rs`) vs `stream.behaviorHints.p2p` (`stream.rs`); defer `behaviorHints.videoSize` / `behaviorHints.videoHash` until subtitle Addon matching unless used for file-choice verification.
2. **File-choice rules when `fileIdx` is absent (or `url` was a `magnet:`)**:
   - Must match or consciously replace `enginefs`'s `GuessFileIdx` pipeline:
     1. Optional regex override (`fileMustInclude`, undocumented for torrents in `stream.md` but implemented in `enginefs`).
     2. Filter torrent files by media file extensions (decide whether to keep `enginefs`'s audio extensions `flac|mp3|wav|wma|aac|ogg` or restrict to video extensions as `fetchVideoParams.js` does).
     3. If the `Video` is a series episode (`season` + `episode` known from the `VideoRef` / `Title`), filter candidates by parsed season and episode (`SxxEyy` / episode naming) before falling back to all media files if none match.
     4. Pick the **largest file by byte length** from the surviving candidates (fail cleanly rather than playing a sample/non-video file if no media file exists).
