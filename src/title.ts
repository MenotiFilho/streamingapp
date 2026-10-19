/**
 * The title model: an opened Title, and the pure decisions a Title screen is
 * drawn from.
 *
 * Opening a Title is a client's own business (ADR-0005): the answer goes to the
 * client that asked, and which Title is open, which season is folded out and
 * which episode is chosen all stay in that client. Nothing here is shared state,
 * and nothing here decides what the Host holds.
 *
 * A meta answer is allowed to be sparse — the Host reads it leniently and gives
 * a Title back however little the Addon said — so the card the client opened it
 * from is the fallback for what the Addon left out. That is what "degrades to
 * what is available" means in the window: the name, the poster and the year a
 * person already saw on the card stand in for what the Addon did not repeat.
 */

import type { MetaPreview, Title, TitleStub, Video } from "./host-client";

/** The protocol's type for the episodic kind of Title, the one with seasons. */
export const SERIES = "series";

/**
 * What a card may already know about the Title it opens: enough to name it and
 * draw its art when the Host's meta answer is sparse (ADR-0011).
 */
export type TitlePreview = Pick<MetaPreview, "name" | "poster"> &
  Partial<Pick<MetaPreview, "background">>;

/** The same, plus the identity a card carries into an Action. */
export type OpenablePreview = TitlePreview &
  Pick<MetaPreview, "id" | "type"> &
  Partial<Pick<MetaPreview, "releaseInfo">>;

/** One season's Videos, in the order the Addon listed them. */
export type Season = {
  /** The season number, or `null` for Videos the Addon placed in no season. */
  season: number | null;
  videos: Video[];
};

/**
 * Whether a Title is the episodic kind, which is what decides whether it has
 * seasons to show. A film is the other kind.
 */
export function isSeries(title: Title): boolean {
  return title.type === SERIES;
}

/**
 * A Title's Videos, grouped into seasons, in the order the Addon listed them.
 *
 * The Addon's order is the order (the spec's Stream rule generalised): the first
 * season to appear is the first group. A Video the Addon placed in no season is a
 * group of its own, where it first appears, rather than dropped.
 */
export function seasonsOf(title: Title): Season[] {
  const seasons = new Map<number | null, Video[]>();
  for (const video of title.videos) {
    const season = video.season ?? null;
    const held = seasons.get(season);
    if (held) {
      held.push(video);
    } else {
      seasons.set(season, [video]);
    }
  }

  return Array.from(seasons, ([season, videos]) => ({ season, videos }));
}

/**
 * How a season is named. A season `0` is a series' specials; no number at all is
 * the Addon not placing a Video in one.
 */
export function seasonName(season: number | null): string {
  if (season === null) {
    return "Videos";
  }
  return season === 0 ? "Specials" : `Season ${season}`;
}

/**
 * How a Video is named on a Title screen: `S2E1`, or the half of it the Addon
 * gave. A Video with neither number is named by its own name alone, which is why
 * this is `null` rather than an empty label.
 */
export function labelOf(video: Video): string | null {
  if (video.season === null && video.episode === null) {
    return null;
  }

  const season = video.season === null ? "" : `S${video.season}`;
  const episode = video.episode === null ? "" : `E${video.episode}`;
  return `${season}${episode}`;
}

/**
 * What to call an opened Title.
 *
 * The Host always names one, standing in the Title's id when the Addon named it
 * nothing — and a client that opened it from a card has a better name than an id
 * already in its hand.
 */
export function nameOf(title: Title, preview?: Pick<MetaPreview, "name"> | null): string {
  if (title.name === title.id && preview && preview.name) {
    return preview.name;
  }
  return title.name;
}

/** The same, for the poster and the year a card shows. */
export function posterOf(
  title: Title,
  preview?: Pick<MetaPreview, "poster"> | null,
): string | null {
  return title.poster ?? preview?.poster ?? null;
}

export function releaseOf(
  title: Title,
  preview?: Partial<Pick<MetaPreview, "releaseInfo">> | null,
): string | null {
  return title.releaseInfo ?? preview?.releaseInfo ?? null;
}

/**
 * The art a Title screen draws first: the Title's own backdrop, then the
 * backdrop of the card it was opened from, then either poster. A card's
 * backdrop is 16:9, so it beats a portrait poster when the meta answer is
 * sparse.
 */
export function backdropOf(title: Title, preview?: TitlePreview | null): string | null {
  return title.background ?? preview?.background ?? posterOf(title, preview) ?? null;
}

/**
 * The TMDB id a Discovered Title's card names, as the key `open_discovered_title`
 * takes. The protocol spells a TMDB-keyed item `tmdb:<id>`; a card that is not
 * one has no Discovered Title behind it.
 */
export function discoveredKeyOf(id: string): { kind: "tmdb"; id: number } | null {
  const match = /^tmdb:(\d+)$/.exec(id);
  if (!match) {
    return null;
  }
  return { kind: "tmdb", id: Number(match[1]) };
}

/**
 * The least of a Title the Host is told when a Stream is chosen (#29).
 *
 * The client has the Title open — it is the client's own (ADR-0005) — so it
 * hands back the card the Host records Watch progress against, and the Addon a
 * removed one is judged by. The card the client opened it from stands in for
 * whatever a sparse meta answer left out, the same fallback the Title screen
 * uses.
 */
export function titleStubOf(title: Title, preview?: TitlePreview | null): TitleStub {
  const background = title.background ?? preview?.background ?? null;

  return {
    addon: title.addon,
    id: title.id,
    type: title.type,
    name: nameOf(title, preview),
    poster: posterOf(title, preview),
    // Only carried when there is one: the field is part of the ready card (#73),
    // and a Host that never sent a backdrop has no key to learn.
    ...(background ? { background } : {}),
  };
}
