# Stremio's account API: what a third-party Host can read

**Date of research:** 2026-10-29 (live HTTP checks at 17:39 UTC; clones and file reads the same day).
**Question:** can a Host read the owner's Stremio **Library** and **Continue watching** without going through the apps?
**Scope:** facts with `file:line` citations. `[inference]` marks what follows from the code but was not observed on the wire. §7 lists what could not be verified.

**Pinned revisions**

| Repo | Revision | Date | Why it matters |
|---|---|---|---|
| `Stremio/stremio-api-client` | `c303559b9e314b691484cc6cfc07c141cef17767` | 2025-04-14 | the repo this note was asked about |
| `Stremio/stremio-core` | `3417c2e7ed45cdbfd86b3226f69814c2dc4947ad` | 2026-10-28 | the client `stremio-web` actually ships |
| `Stremio/stremio-web` | `c34935cc36e28c00ec15f066c38bbc6f6f59f716` | 2026-10-28 | proves which client is current |

## 0. Source status (read this first)

| Target | Status | Evidence |
|---|---|---|
| `github.com/Stremio/stremio-api-client` | **Exists. MIT. 38 stars, 7 forks.** Created 2018-07-10, last push 2025-04-25. | `gh api repos/Stremio/stremio-api-client` |
| What it is | **A wrapper: 270 lines in its two modules** (290 across the package). It does not define the API; it posts to it. | `apiClient.js:11-40`, `apiStore.js:37-186` |
| `github.com/Stremio/stremio-core` | **Exists. MIT. 2,521 stars**, pushed 2026-10-28. This is the client that talks to the service in the shipped apps. | `gh api repos/Stremio/stremio-core` |
| What the web app uses today | **`stremio-core`, not `stremio-api-client`**: `@stremio/stremio-core-web` 0.66.0. | `stremio-web/package.json:25` |
| Public API documentation | **None.** There is no published contract, versioning note or ToS page for `api.strem.io`. The method surface below was reconstructed from client code. | no such page found; §7 |

So the honest framing: `stremio-api-client` is not the Stremio API. It is one small consumer of an undocumented internal API, and the same API is fully visible in `stremio-core`.

## 1. The repo is a transport, not a surface

`apiClient.js` is the whole protocol:

```js
// apiClient.js:11-40
this.request = function(method, params) {
    var fetchOptions = {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ authKey: authKey }, params))
    };
    return fetch(endpoint + '/api/' + method, fetchOptions) ...
```

Three facts fall out of it, and they hold for every `api.strem.io` method in §2:

1. **Everything is `POST https://api.strem.io/api/<method>`**, one JSON object, `authKey` merged in at the top level.
2. **Refusals arrive with HTTP 200.** The body is `{"error": {...}}` and the status is 200 (observed, §6), so a client that trusts the status code reads a refusal as success. This client checks the status first (`apiClient.js:22-24`) and the body after (`:29-31`).
3. **Auth is one opaque `authKey` string**, returned by `login`, sent on every later call. There is no refresh token and no expiry field.

What the store on top adds is session and Addons only (`apiStore.js:60-186`): the four sign-in paths, `logout`, pull and push of the Add-on collection, and pull and push of the user document. **It names no library call and no progress call** — `request()` is the only escape hatch, and every caller of `datastore*` lives in `stremio-core`. That is where the rest of this note reads the surface from.

## 2. The surface that exists

Reconstructed from `stremio-core/src/types/api/request.rs` (path → method at `:158-178`, auth variants at `:191-216`):

| Area | Methods | Body beyond `authKey` |
|---|---|---|
| Session | `login`, `loginWithToken`, `register`, `authWithFacebook`, `authWithApple`, `logout`, `deleteUser` | credentials / GDPR consent |
| Account | `getUser`, `saveUser` | the whole user document |
| Addons | `addonCollectionGet`, `addonCollectionSet` | `update` (bool) / `addons` |
| **User data** | **`datastoreMeta`, `datastoreGet`, `datastorePut`** | `collection` + `ids`/`all` or `changes` |
| Extras | `dataExport`, `events`, `seekLog`, `getSkipGaps`, `getModal`, `getNotification` | see §5 |
| Outside `api.strem.io` | `https://link.stremio.com/api/v2/create` and `/read` — sign in on another device by code/QR | none / `code` |
| Outside `api.strem.io` | `https://likes.stremio.com/api/{get_status,send}` — per-Title like/dislike | `mediaId`, `mediaType`, `status` |

`datastore*` is the interesting part, and it is generic: a `collection` name plus one of three commands (`request.rs:301-346`).

```jsonc
// datastoreMeta — the collection's index
{ "authKey": "…", "collection": "libraryItem" }
// → [ ["tt0903747", 1793227810000], … ]            id + mtime, ms since epoch

// datastoreGet — documents
{ "authKey": "…", "collection": "libraryItem", "ids": [], "all": true }
// → { "result": [ { …LibraryItem… }, … ] }

// datastorePut — upsert by `_id`
{ "authKey": "…", "collection": "libraryItem", "changes": [ { …LibraryItem… } ] }
```

The collection that matters is `libraryItem` (`constants.rs:20`). `stremio-core` uses exactly these three calls for the owner's Library, at sign-in and on every sync: the full pull at `ctx.rs:347-367`, the index at `update_library.rs:505`, the delta pull at `:472-476`, the push at `:447-453`.

## 3. Library and Continue watching are one collection

This is the answer to the question. **Both are the same `libraryItem` documents.** There is no separate Library endpoint and no history endpoint; the row and the room are two readings of one collection.

A `LibraryItem` (`library_item.rs:20-42`) is:

```jsonc
{
  "_id": "tt0903747",              // the Title's id, and the library item's id
  "name": "Breaking Bad",          // the card's name, as of when it was saved
  "type": "series",
  "poster": "https://…/poster.jpg",
  "posterShape": "poster",
  "removed": false,                 // tombstone flag: removed from the Library
  "temp": false,                    // "played but never saved"
  "_ctime": "2024-03-01T20:11:02.000Z",
  "_mtime": "2026-10-28T22:40:10.000Z",
  "state": {                        // library_item.rs:279-322
    "lastWatched": "2026-10-28T22:40:10.000Z",
    "timeWatched": 1840000,         // ms, this video
    "timeOffset": 612000,           // ms into the video
    "overallTimeWatched": 142000000,
    "timesWatched": 3,
    "flaggedWatched": 0,
    "duration": 2820000,
    "video_id": "tt0903747:5:14",   // the last video played
    "watched": "tt0903747:5:14:62:<base64>",
    "noNotif": false
  },
  "behaviorHints": {}
}
```

The two readings, as `stremio-core` performs them:

| Reading | Predicate | Sort |
|---|---|---|
| **Library** | `removed === false` | `stremio-core` sorts the Library screen by `state.lastWatched`, with name and times-watched as alternatives (`library_with_filters.rs:56-79`) |
| **Continue watching** | `type !== "other"` **and** (`removed === false` **or** `temp === true`) **and** `state.timeOffset > 0` — `library_item.rs:55-59` | `_mtime` descending — `continue_watching_preview.rs:87-118` |

Two consequences worth stating plainly:

- **A Host does not need to ask an Addon for the card.** The account's item carries `name` and `poster` — the two fields ADR-0015 says the Host lacks for a Continue watching card. They were written at save time, so they are as fresh as the last time a Stremio app refreshed the item, not as fresh as the Addon's meta.
- **The index makes polling cheap.** `datastoreMeta` returns `[id, mtime]` pairs only, so a sync can decide what changed and pull just those ids (`update_library.rs:491-520`) instead of re-reading the whole collection.

`temp: true, removed: true` is the shape `stremio-core` creates when playback starts on a Title that is not in the Library (`library_item.rs:231-236`, reached from `player.rs:1455-1458`). It is progress that was recorded but never saved, and it is the closest thing the API has to a watch log (§5).

## 4. Six ways it bites

1. **`state.lastWatched` mixes two clocks.** Marking a *video* (or a season) watched writes the video's **release date** when that is later than what was stored (`library_item.rs:132-140`, `:214-221`), so a 2013 episode marked today records 2013. Playback and whole-Title marks instead write *now* (`player.rs:527`, `:627`, `library_item.rs:110`). No single field answers "when was this watched"; for "most recently touched", order by `_mtime`.
2. **Two time formats.** `datastoreMeta` gives milliseconds since epoch, because the index type deserializes with `ts_milliseconds` (`response.rs:78-82`); `datastoreGet` gives ISO-8601 strings (`_ctime`, `_mtime`, `lastWatched`). The asymmetry is the server's — `[inference, from the chrono shapes at library_item.rs:33-38 rather than a live reply]`.
3. **One item per Title, not per episode.** A series is a single `libraryItem`; the current episode is `state.video_id`, and the watched episodes are the bitfield `state.watched`. Nothing in the collection is keyed by episode.
4. **The watched bitfield is an anchored, packed byte string.** `{anchor video id}:{anchor length}:{base64 of the packed bits}` (`stremio-watched-bitfield/README.md`, `lib/watchedBitfield.js:84-92`). The anchor is what lets it survive an Addon appending episodes: `constructAndResize` shifts the bits by the anchor's position instead of assuming index 0 (`lib/watchedBitfield.js:20-57`). Recompute it without the anchor and the bits land on the wrong episodes.
5. **`datastorePut` is a per-document write.** The client sends whole `LibraryItem`s and the server keys them by `_id` (`update_library.rs:447-453`). Whether an omitted field is merged or erased is not documented — `[inference: erased]`, which is why this Host keeps Stremio's documents raw (`crates/host-core/src/sync.rs:188-196`).
6. **Removals are tombstones, not deletes.** Removing from the Library flips `removed` to `true`, clears `temp`, and re-pushes the document (`update_library.rs:77-113`); `stremio-core` keeps syncing such a tombstone for 365 days (`library_item.rs:49-53`). A reader that does not filter on `removed` shows Titles that are no longer in the Library.

## 5. What is not there

| Wanted | Verdict |
|---|---|
| **A linear watch history** ("watched this episode on this date") | **No endpoint.** `libraryItem` holds only the latest state per Title: one `video_id`, one `timeOffset`, one `lastWatched`, plus the bitfield's *set* of watched episodes with no timestamps. `events` is write-only telemetry (`request.rs:82-85`) and `seekLog` is playback analytics (`:88-89`), neither readable back. |
| **Playback of unsaved Titles** | Only as `temp` tombstones, for as long as the account keeps them `[inference: the client's 365-day window is its own filter, the server's retention is not documented]`. Sparse and unguaranteed. |
| **Per-period statistics** | Nothing. Only per-Title aggregates: `timesWatched`, `overallTimeWatched`, `timeWatched`. |
| **The Library with its own ordering or folders** | The account stores no order. Order is drawn client-side (§3). |
| **A full account dump** | `dataExport` exists and returns an export id, from which the client builds `https://api.strem.io/data-export/<id>/export.json` (`models/data_export.rs:54-60`). The file's contents were **not verified** (§7). |

The blunt summary: the API can tell you **what is in the Library and where playback stands per Title**. It cannot tell you **what was watched, in what order, on which day**.

## 6. Live checks (2026-10-29, 17:39 UTC)

Anonymous calls, no account and no credentials, so nothing below is a claim about a real Library's contents.

| Request | HTTP | Body |
|---|---|---|
| `POST /api/datastoreMeta` `{"collection":"libraryItem"}` | 200 | `{"error":{"code":1,"message":"Session does not exist"}}` |
| `POST /api/datastoreGet` `{"collection":"libraryItem"}` | 200 | same |
| `POST /api/datastorePut` `{"collection":"libraryItem"}` | 200 | same |
| `POST /api/dataExport` `{}` | 200 | same |
| `POST /api/getUser` `{}` | 200 | the anonymous profile: `_id` all zeros, empty `email`, `maxProfiles: 3`, `premiumMaxProfiles: 6`, `premiumPrefs.userProfiles` with a single `"Master Profile"` and `hasPin: false` |
| `POST /api/addonCollectionGet` `{"update":true}` | 200 | 7 official manifests; `isInitial: true`; `lastModified: "2026-10-29T17:39:43.182679299Z"` |
| `POST /api/getNotification` `{}` | 200 | `{}` |
| `POST /api/getModal` `{}` | 200 | `{"error":{"message":"Failed to parse date"}}` |
| `GET https://link.stremio.com/api/v2/create` | 200 | `{"result":{"success":true,"code":"…","link":"https://link.stremio.com/…","qrcode":"https://link.stremio.com/qr?data=…"}}` |

Three things this settles that the README does not:

- **The user's data needs a session.** `datastore*` and `dataExport` answer `Session does not exist` without `authKey`; there is no anonymous read of anybody's Library.
- **Addons and profile do not.** A fresh Host can fetch the official Addon collection and render an account-free state without any credential.
- **An expired key looks the same as a missing one** (`Session does not exist`), so a sign-in can fail long after it succeeded and the error message will not say so.

## 7. Could not verify

- **Whether `datastoreGet all: true` returns removed tombstones.** `[inference: yes]` — `stremio-core` diffs its own removed items against the index and pushes them, which is only meaningful if the server also returns them. Not observed, because it needs an account.
- **Whether `datastorePut` merges or replaces a document.** The shape of the call is known; the server's write semantics are not, and both clients always send whole documents, so nothing distinguishes the two cases. `[inference: replaces]`, per §4.5.
- **The contents of `export.json`**, and whether it carries anything beyond the Library (watch log, profile, addons).
- **Whether `authKey` expires, and after how long.** No TTL is documented or returned; the only observed signal is the refusal message.
- **Rate limits, quotas, and whether burst reads are throttled.** Not probed; it would need a real account and many reads.
- **Stability.** No versioning of `api.strem.io` is visible; `link.stremio.com` has an explicit `/v2/` prefix and `api.strem.io` has none. The surface can change when the official apps do, without notice.
- **Permission to use it.** No published terms cover this endpoint, and no statement exists that third-party clients may read a user's account. That is a judgement for the owner, not a fact this note can settle.

## 8. What this means for this Host

**The code is already most of the way there.** `HttpStremio` signs in, reads `datastoreGet {all: true}` and writes `datastorePut` (`crates/host-addon/src/stremio.rs:88-146`), and the seam above it is three calls (`crates/host-core/src/stremio.rs:19-29`). What a Library screen would add is small:

1. a **read-only pull** that keeps `removed` items out of the room and keeps them in the store as tombstones;
2. the **index** (`datastoreMeta`) so a refresh is a diff, not a re-download;
3. **`_mtime` ordering** for "recently added" and "last watched", never `state.lastWatched` (§4.1).

**The API is not the obstacle; the decision is.** `CONTEXT.md` defines **Library** as membership that "is not built", ADR-0016 scopes Account sync to Watch progress only, and ADR-0020 calls the Library "a sign-in-gated stub on this map". Nothing in the API contradicts those — it simply means that shipping a Library screen is a new decision (a new ADR), not a correction to an existing one.

**Two rules that should survive that decision.**

- **The account's Continue watching is not this Host's.** `CONTEXT.md` defines Continue watching as the Host's own record, drawn offline from Watch progress, one card per Video, unplayable entries kept. The account's row is per Title, needs the network, and carries a different resume point. Reading both is fine; **merging them silently is not**, because two rows would then disagree about the same Title with no way for a client to tell which is authoritative.
- **ADR-0015's "the Host does not have the name and poster" argument does not apply to the account's Library.** That ADR rejected fetching meta at `PlayStream` for the Host's *own* cards. The account's items already carry both fields, so a Library room costs no Addon round trip — provided the room accepts that the card is as fresh as the account's last refresh.
