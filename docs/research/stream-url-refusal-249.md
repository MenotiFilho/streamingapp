# Why a listed Stream answers "The Host will not play that Stream" (#249)

## Finding

The refusal's detail was **not recoverable from the Windows build's log**: the
Host's `host.log` records slow questions and lifecycle, not the text of a refused
`play_stream`. The cause below is therefore established from the code, not from a
captured detail, and the by-hand check is listed at the end.

Of the three origins named in the issue, only one lets a candidate be *listed as
playable* and then refused at the press:

| Origin | Marked in the list first? |
| --- | --- |
| `infoHash` (`ChosenStream::parse`) | Yes — `playabilityNote` keys on `playback.kind === "info_hash"`, and the Stream's wire shape carries that kind for every Addon. Not the cause. |
| Resume finds no Addon (`host.rs` resume) | Not a list refusal: it is the resume path. |
| `StreamUrl::parse` refusing a URL | **No.** The list holds a `url` of up to `MAX_STRING_LEN` (4096 bytes); `StreamUrl` refused anything over `MAX_URL_LEN` (2048). |

A direct URL of 2049–4096 bytes was a `Direct` candidate, unmarked, and refused at
the press as `"…" is not a Stream URL`. Debrid and AIOStreams-style URLs carry the
owner's configuration or a signed token in their path and routinely pass 2 KiB.

## Decision

`StreamUrl::parse` takes the same bound the list holds (`MAX_STRING_LEN`). The
manifest URL keeps `MAX_URL_LEN`: it is typed or pasted by the owner, not issued
by an Addon. Test: `a_direct_url_the_list_holds_is_a_url_the_host_plays`
(`crates/host-core/src/playback.rs`).

## Still open

- A `url` with a scheme other than `http(s)` (`magnet:`, `stremio://`, a relative
  path) is also listed as `Direct`, unmarked, and refused at the press. No Addon
  in hand was seen sending one; if a by-hand run shows the refusal detail is
  `…is not a Stream URL` with a short URL, this is the cause and the fix is to
  judge the URL where the Stream is read, so the list can mark it.
- By hand: reproduce with the Addon that refuses and read the detail text on
  screen (the window prints it after the colon); the Host does not log it.
