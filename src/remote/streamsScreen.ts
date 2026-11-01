import type { Action, AddonStreams, Title, Video } from "../core/wire";

/**
 * The Streams level's own decisions and its own copy (#210, ADR-0035 §1).
 *
 * The list's bookkeeping is the core's: `candidateCount`, `candidateCountLabel`,
 * `badgeRole`, `groupAnswerNote`, `streamsSubject`, `warningNote` and the
 * playability rule in `stream.ts`. What lives here is the ask the level makes,
 * the unplayable mark its answer settles (ADR-0020's second half), and the
 * words this level alone prints.
 */

/**
 * The one question the level asks: every configured Addon that answers the
 * Video, in the Host's own fan-out. The Video is named the way the Host reads
 * it — the Title's type and the Video's own id.
 */
export function streamsAsk(title: Title, video: Video): Action {
  return { type: "find_streams", video: { type: title.type, id: video.id } };
}

/**
 * What a Streams answer means for the Title's unplayable mark, or null where it
 * proves nothing either way (ADR-0020).
 *
 * A candidate anywhere means this Host can play the Title, and clears a mark an
 * earlier answer set. No candidate at all means it cannot — but only when every
 * group actually answered: an Addon that failed is a Host that does not know
 * yet, not a Title with no Streams, so the mark is left as it was.
 */
export function unplayableAfter(groups: readonly AddonStreams[]): boolean | null {
  if (groups.some((group) => group.streams.length > 0)) {
    return false;
  }
  return groups.every((group) => group.failure === null) ? true : null;
}

/** The kicker over the list: what the page is, in the programme's voice. */
export const SCREENING_LIST = "A screening list";

/** What the level says while the Host is still asking every Addon. */
export const STREAMS_LOOKING = "Looking for Streams…";

/** What the level says where no Addon answered with a group at all. */
export const STREAMS_NONE = "No configured Addon offers Streams for this Video.";

/** What a candidate's wait says beside the row that was pressed. */
export const STREAM_OPENING = "Opening…";
