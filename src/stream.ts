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
 * Choosing a candidate this Host can open plays it (#27); one it cannot stays in
 * the list, marked, so the list is what exists rather than only what will work.
 */

import type { Playback, Stream, StreamWarning, Title, Video } from "./host-client";
import { isSeries, labelOf, nameOf, tmdbFilmId, type OpenablePreview } from "./title";

/**
 * The Video a film is watched as: the film itself. A film's Title lists no
 * Videos, so pressing play on it asks for the Streams of one Video.
 *
 * A Title a TMDB record met is played in TMDB's spelling, which is what unifies
 * it in Continue watching with the same film opened as a Discovered Title: the
 * Host keys progress by the Video, and `tmdb:<id>` is the spelling both paths
 * share (ADR-0020). A Title keyed by its Addon keeps the id its Addon indexes.
 * The Host does not renumber the Video a client named.
 */
export function theFilm(title: Title): Video {
  const id = title.key.kind === "tmdb" ? tmdbFilmId(title.key.id) : title.id;
  return { id, name: null, season: null, episode: null, thumbnail: null };
}

/**
 * A candidate's badge lines: the Addon's name for it, split on its own line
 * breaks. An Addon may write several badges in one string (`4k DV | HDR` under
 * `Torrentio`), and each line is drawn as its own. Takes anything with a name —
 * a candidate in a list, and the Stream that is playing.
 */
export function badgeLines(named: { name: string | null }): string[] {
  return (named.name ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * What the Streams are Streams *of*: a series' episode by the number and name
 * its Addon listed, or the Title a film is. Both surfaces name the level with
 * this, so the waiting line and the list cannot drift.
 */
export function streamsSubject(
  title: Title,
  preview: OpenablePreview | null | undefined,
  video: Video,
): string {
  if (!isSeries(title)) {
    return nameOf(title, preview);
  }

  const episode = labelOf(video);
  if (!episode) {
    return video.name ?? video.id;
  }
  return video.name ? `${episode} — ${video.name}` : episode;
}

/**
 * What the list says about playing a candidate: nothing for a URL the Host can
 * open, and the reason for one it cannot. A candidate is never hidden for being
 * unplayable — it is listed and marked, and pressing it says so rather than
 * pretending to play.
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
 * What the window says about a candidate it will not play: the Addon's own name
 * for it, and why it stays in the list. A candidate the Host can open never
 * reaches this — pressing it plays it.
 */
export function unplayableNote(stream: Stream): string {
  const why = playabilityNote(stream.playback);
  return why === null ? streamName(stream) : `${streamName(stream)} — ${why}`;
}
