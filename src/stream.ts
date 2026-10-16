/**
 * The stream model: the candidates one Addon offered for a Video, as the window
 * draws them, and the pure decisions that go with them.
 *
 * The Host does the deciding — which Addons are asked, which candidates exist,
 * what can be played — and this module only says how those facts are drawn. The
 * Addon's own words arrive verbatim (its badge line and the release line under
 * it), so nothing here re-words or re-orders a Stream: what a person configured
 * their Addon to say is what the list shows.
 *
 * Playing a Stream is #27's business; until then a chosen candidate is this
 * client's own selection, held here and shown.
 */

import type { Playback, Stream, StreamWarning, Title, Video } from "./host-client";

/**
 * The Video a film is watched as: the film itself. A film's Title lists no
 * Videos, so pressing play on it asks for the Streams of the Title's own id.
 */
export function theFilm(title: Title): Video {
  return { id: title.id, name: null, season: null, episode: null };
}

/**
 * A candidate's badge lines: the Addon's name for it, split on its own line
 * breaks. An Addon may write several badges in one string (`4k DV | HDR` under
 * `Torrentio`), and each line is drawn as its own.
 */
export function badgeLines(stream: Stream): string[] {
  return (stream.name ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * What the list says about playing a candidate: nothing for a URL the Host can
 * open, and the reason for one it cannot. A candidate is never hidden for being
 * unplayable — it is listed and marked.
 */
export function playabilityNote(playback: Playback): string | null {
  switch (playback.kind) {
    case "direct":
      return null;
    case "info_hash":
      return "Not playable yet — a torrent this Host cannot fetch.";
  }
}

/** What a hint says, in a person's words. */
export function warningNote(warning: StreamWarning): string {
  switch (warning) {
    case "not_web_ready":
      return "Not web-ready — the Addon says this URL is not fit for a browser.";
    case "p2p":
      return "Peer-to-peer — this Stream comes from peers.";
    case "proxy_headers":
      return "Wants request headers, which the Host does not send yet.";
  }
}

/**
 * How a candidate is named in a sentence: the first of its badge lines, its
 * filename, or the least that says which one it is.
 */
export function streamName(stream: Stream): string {
  const [first] = badgeLines(stream);
  return first ?? stream.filename ?? "this Stream";
}

/**
 * What the window says once a candidate is chosen. An unplayable candidate is
 * said to be one; a playable one waits for the ticket that plays it (#27).
 */
export function chosenNote(stream: Stream): string {
  const note = playabilityNote(stream.playback);
  return note
    ? `Chose ${streamName(stream)}. ${note}`
    : `Chose ${streamName(stream)} — playing it arrives in #27.`;
}
