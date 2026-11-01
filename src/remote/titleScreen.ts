import type { NewLevel } from "../core/navigation";
import { discoveredKeyOf, type TitlePreview } from "../core/title";
import type { Action, Title, Video } from "../core/wire";
import type { RemotePayload, RemoteTitle } from "./levels";

/**
 * The Title level's own decisions and its own copy (#210, ADR-0035 §1).
 *
 * The shape the page is drawn from is the core's: `titleFacts`, `titleSide`,
 * `unmappedOf` and the art fallback in `title.ts`. What lives here is what only
 * this level decides — which of the Host's two Title questions a card asks, the
 * fallback a card gives a sparse answer, the level a Play pushes, and the level
 * an answer replaces.
 */

/**
 * What a press on a card asks, or null where the card names no question.
 *
 * An Addon card asks `open_title` with the Addon that answered its row. A
 * Discover or keyed-Search card carries no Addon, because TMDB named the Title
 * before any Addon did, and asks `open_discovered_title` with the TMDB key the
 * core reads from the card's id (ADR-0020). A card that is neither is not a
 * Title this client can open, and nothing is sent rather than a guess.
 */
export function titleOpenAction(card: RemoteTitle): Action | null {
  if (card.addon !== null) {
    return {
      type: "open_title",
      addon: card.addon,
      title: { type: card.type, id: card.id },
    };
  }

  const key = discoveredKeyOf(card.id);
  return key === null
    ? null
    : { type: "open_discovered_title", key, kind: card.type };
}

/**
 * The card as the fallback the core's drawing reads: the name a person already
 * saw, and no art of its own. The Remote's cards carry no poster into the
 * level, so the Title's own art is what is drawn; only the name stands in for a
 * sparse meta answer (ADR-0011).
 */
export function cardPreviewOf(card: RemoteTitle): TitlePreview {
  return { name: card.name, poster: null };
}

/**
 * The Title level, answered: the same id the level was pushed with, so the
 * navigation replaces it in place rather than stacking a second one. A Streams
 * level above it and a Back therefore find the answer instead of asking the
 * Host again.
 */
export function answeredTitleLevel(
  card: RemoteTitle,
  title: Title,
  id: string,
): NewLevel<RemotePayload> {
  return {
    id,
    name: "Title",
    kind: "overlay",
    payload: { kind: "title", title: card, answer: title },
  };
}

/**
 * The Streams level a Play pushes. It carries the answered Title and the Video,
 * which is all the list asks `find_streams` by and all its head is drawn from.
 */
export function streamsLevelFor(
  title: Title,
  video: Video,
): NewLevel<RemotePayload> {
  return {
    name: "Streams",
    kind: "overlay",
    payload: { kind: "streams", title, video },
  };
}

/** What a loading level says under the card it is opening. */
export const TITLE_LOOKING = "Looking for this Title…";

/** What a person presses to ask again after a refusal or an answer with no Title. */
export const TITLE_RETRY = "Open again";

/** An answer that carried no Title is not a Title, and does not pretend to be one. */
export const TITLE_NO_ANSWER = "The Host's answer carried no Title.";

/** A card with neither an Addon nor a TMDB id has no question this client can ask. */
export const TITLE_UNOPENABLE =
  "This card names no Addon and no TMDB Title, so there is nothing to open.";

/** The brass Unmapped stamp, in the design record's own words. */
export const TITLE_UNMAPPED =
  "Unmapped — no TMDB record met this Title, so it is keyed by its Addon.";

/** The one action a Title's side offers, for a film and for a chosen episode. */
export const FIND_STREAMS = "Find Streams";
