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

import type { Action, Playback, Stream, StreamWarning, Title, Video } from "./wire";
import {
  isSeries,
  labelOf,
  nameOf,
  titleStubOf,
  tmdbFilmId,
  type OpenablePreview,
  type TitlePreview,
} from "./title";

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
 * The one Action a chosen Stream is: the Video asked about, the Addon that
 * offered the candidate, the candidate itself, and the least of the Title the
 * Host records Watch progress against (#29, #27).
 *
 * Both clients build it here rather than in their own drawing, so the Action a
 * window and a phone send for the same candidate cannot differ. The card stands
 * in for what a sparse meta answer left out, which is the same fallback the
 * Title screen draws from (ADR-0011).
 */
export function playStreamAction(
  title: Title,
  video: Video,
  addon: string,
  stream: Stream,
  preview?: TitlePreview | null,
): Extract<Action, { type: "play_stream" }> {
  return {
    type: "play_stream",
    video: { type: title.type, id: video.id },
    addon,
    stream,
    title: titleStubOf(title, preview),
  };
}

/**
 * The longest URL the Host will take from a Stream: the same `MAX_STRING_LEN`
 * bound `StreamUrl::parse` applies. A debrid URL carries the owner's
 * configuration and runs past 2 KiB, so the bound is the Stream's own words,
 * not a manifest's (#249).
 */
const MAX_STREAM_URL_LEN = 4096;

/**
 * Whether a direct Stream's URL is one the Host will open: `StreamUrl::parse`
 * accepts only `http` and `https` addresses with a host, within the length
 * bound and free of control characters. The list marks a candidate this says no
 * to before the press, rather than letting the Host refuse it after (ADR-0009,
 * #249).
 */
function playableDirectUrl(raw: string): boolean {
  // The Host's bound is in bytes (Rust's `str::len`), not UTF-16 units.
  const bytes = new TextEncoder().encode(raw).length;
  if (bytes === 0 || bytes > MAX_STREAM_URL_LEN) {
    return false;
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(raw)) {
    return false;
  }
  try {
    const url = new URL(raw);
    return (url.protocol === "http:" || url.protocol === "https:") && url.host.length > 0;
  } catch {
    return false;
  }
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
      return playableDirectUrl(playback.url)
        ? null
        : "Not playable — a direct Stream must be an http(s) address.";
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
