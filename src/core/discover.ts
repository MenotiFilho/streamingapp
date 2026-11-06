/**
 * Discover: TMDB's feed of Discovered Titles, and the pure decisions the
 * window draws it from.
 *
 * Discover is not a Catalog (CONTEXT.md): it takes TMDB's own filters — the
 * kind, a page and a genre — rather than an Addon's declared `extra`, and every
 * page is asked fresh (ADR-0020). The feed this client has
 * read so far is its own, like a catalog row: paging it moves nothing on any
 * other device (ADR-0005).
 *
 * The genre lists are TMDB's, captured from `/genre/movie/list` and
 * `/genre/tv/list` as the #48 research note records them. The two lists are not
 * the same set. Discover draws one genre row, their union by name with **All
 * genres** first, and a chip carries the id each kind is asked by; a kind with
 * no counterpart answers `null` so its row can say so rather than hiding it
 * (ADR-0036 §1). The Host judges the ids against the same split (research note
 * §3, ADR-0020).
 */

import type { Action, AddonManifest, DiscoverRow, MetaPreview } from "./wire";
import { SERIES } from "./title";

/** The protocol's spelling of a film's kind. */
export const MOVIE = "movie";

/** The two kinds Discover can ask TMDB for. */
export type DiscoverKind = typeof MOVIE | typeof SERIES;

/** One genre a kind can be filtered by: TMDB's stable id and the name it reads by. */
export type DiscoverGenre = { id: number; name: string };

/**
 * The genre ids TMDB lists for films, by the names this window draws.
 * Localized names are TMDB's, but the id is what travels; this window speaks
 * the language its own interface is written in (research note §3.1).
 */
const MOVIE_GENRES: readonly DiscoverGenre[] = [
  { id: 28, name: "Action" },
  { id: 12, name: "Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 14, name: "Fantasy" },
  { id: 36, name: "History" },
  { id: 27, name: "Horror" },
  { id: 10402, name: "Music" },
  { id: 9648, name: "Mystery" },
  { id: 10749, name: "Romance" },
  { id: 878, name: "Science Fiction" },
  { id: 10770, name: "TV Movie" },
  { id: 53, name: "Thriller" },
  { id: 10752, name: "War" },
  { id: 37, name: "Western" },
];

/** The genre ids TMDB lists for series — not the film set (research note §3.2). */
const SERIES_GENRES: readonly DiscoverGenre[] = [
  { id: 10759, name: "Action & Adventure" },
  { id: 16, name: "Animation" },
  { id: 35, name: "Comedy" },
  { id: 80, name: "Crime" },
  { id: 99, name: "Documentary" },
  { id: 18, name: "Drama" },
  { id: 10751, name: "Family" },
  { id: 10762, name: "Kids" },
  { id: 9648, name: "Mystery" },
  { id: 10763, name: "News" },
  { id: 10764, name: "Reality" },
  { id: 10765, name: "Sci-Fi & Fantasy" },
  { id: 10766, name: "Soap" },
  { id: 10767, name: "Talk" },
  { id: 10768, name: "War & Politics" },
  { id: 37, name: "Western" },
];

/** The filters one kind offers: TMDB's list for that kind and no other. */
export function genresOf(kind: DiscoverKind): readonly DiscoverGenre[] {
  return kind === SERIES ? SERIES_GENRES : MOVIE_GENRES;
}

/**
 * One chip of Discover's one genre row: the name a person reads, the id each
 * kind is asked by, and whether the chip filters at all.
 */
export type DiscoverGenreChoice = {
  /** The chip's text: TMDB's film name for a genre, or All genres. */
  name: string;
  /** The id films are asked by, or `null` where films have no such genre. */
  movie: number | null;
  /** The id series are asked by, or `null` where series have no such genre. */
  series: number | null;
  /**
   * Whether the choice filters nothing. All genres is the row's first chip; a
   * genre that answers `null` for a kind is instead "no counterpart", and that
   * kind's row is drawn empty with a line saying so.
   */
  all: boolean;
};

/** The chip that clears the genre filter: TMDB's whole weekly feed. */
export const ALL_GENRES: DiscoverGenreChoice = {
  name: "All genres",
  movie: null,
  series: null,
  all: true,
};

/**
 * The series genre TMDB folds a film genre into where the two lists name it
 * differently: Action and Adventure are *Action & Adventure*, Science Fiction
 * and Fantasy are *Sci-Fi & Fantasy*, War is *War & Politics* (ADR-0036 §1).
 */
const SERIES_FOLD: Readonly<Record<number, number>> = {
  28: 10759,
  12: 10759,
  14: 10765,
  878: 10765,
  10752: 10768,
};

/** The series genres reached through a film genre, so never chips of their own. */
const SERIES_FOLDED: ReadonlySet<number> = new Set(Object.values(SERIES_FOLD));

/** The series id a film genre is asked by, or `null` where series have no counterpart. */
function seriesIdFor(film: DiscoverGenre): number | null {
  const folded = SERIES_FOLD[film.id];
  if (folded !== undefined) {
    return folded;
  }
  return SERIES_GENRES.find((genre) => genre.name === film.name)?.id ?? null;
}

/**
 * Discover's one genre row: All genres, TMDB's film list in its own order,
 * then the series-only names. The combined series genres are not chips of
 * their own — they are reached through the film parts that fold into them
 * (ADR-0036 §1).
 */
export const DISCOVER_GENRES: readonly DiscoverGenreChoice[] = [
  ALL_GENRES,
  ...MOVIE_GENRES.map((film) => ({
    name: film.name,
    movie: film.id,
    series: seriesIdFor(film),
    all: false,
  })),
  ...SERIES_GENRES.filter(
    (genre) =>
      !SERIES_FOLDED.has(genre.id) &&
      !MOVIE_GENRES.some((film) => film.name === genre.name),
  ).map((genre) => ({
    name: genre.name,
    movie: null,
    series: genre.id,
    all: false,
  })),
];

/**
 * The id a chosen genre asks a kind by, or `null` where that kind has no
 * counterpart: the row is then drawn empty rather than hidden (ADR-0036 §1).
 */
export function genreIdFor(choice: DiscoverGenreChoice, kind: DiscoverKind): number | null {
  return kind === MOVIE ? choice.movie : choice.series;
}

/** One page a client is asking for: the kind, the page, and the genre filter. */
export type DiscoverPage = {
  kind: DiscoverKind;
  page: number;
  genre: number | null;
};

/**
 * The ask for one page: the week's trending feed where no genre is chosen,
 * and a `/discover` page where one is. The Host builds the URL and judges the
 * genre against the kind's own list (ADR-0020); this client only says what a
 * person chose, and no sort control has been asked for yet.
 */
export function discoverAsk({ kind, page, genre }: DiscoverPage): Action {
  return {
    type: "discover",
    kind,
    page,
    ...(genre === null ? {} : { genre }),
  };
}

/** One Discover feed as this client has read it so far. */
export type DiscoverFeed = {
  /** The last page answered, or 0 before one was. A failed page is asked again. */
  page: number;
  /** The items read so far, in TMDB's order, one of each id. */
  items: MetaPreview[];
  failure: DiscoverRow["failure"];
  /** Set when a page brought nothing at all, so there is no more to ask for. */
  done: boolean;
};

/** A feed with nothing read yet: where a kind or a genre change starts. */
export function blankFeed(): DiscoverFeed {
  return { page: 0, items: [], failure: null, done: false };
}

/**
 * The same feed with one page folded in.
 *
 * A page is appended and duplicates are dropped (TMDB's feed is live and can
 * repeat an item across pages), and the page number only moves on a page that
 * answered: a failed call keeps the feed — and the way to ask that page again —
 * exactly where it was (ADR-0020). `sent` is what TMDB sent, unreadable items
 * included, so only a page TMDB left empty ends the feed; a page that held
 * nothing this Host could read is a page the next one still follows.
 */
export function feedWith(feed: DiscoverFeed, answer: DiscoverRow): DiscoverFeed {
  const fresh = answer.failure
    ? []
    : answer.metas.filter((meta) => !feed.items.some((held) => held.id === meta.id));

  return {
    ...feed,
    page: answer.failure ? feed.page : feed.page + 1,
    items: [...feed.items, ...fresh],
    failure: answer.failure,
    done: answer.failure ? feed.done : answer.sent === 0,
  };
}

/** The protocol's prefixes that can name a TMDB Title: TMDB's own, and IMDb's old one. */
const TMDB_PREFIX = "tmdb";
const IMDB_PREFIX = "tt";

/**
 * The spelling an Addon's stream resource declares, read the way the Host
 * reads it: a resource with no prefixes of its own falls back to the
 * manifest's, and `tmdb` is preferred over `tt` where both are declared
 * (ADR-0020, `Manifest::declared_prefixes`).
 */
function spellingOf(
  addon: AddonManifest,
  resource: AddonManifest["resources"][number],
): "tmdb" | "tt" | null {
  const declared =
    resource.idPrefixes ?? (addon.idPrefixes.length === 0 ? [] : addon.idPrefixes);
  if (declared.some((prefix) => prefix.startsWith(TMDB_PREFIX))) {
    return "tmdb";
  }
  if (declared.some((prefix) => prefix === IMDB_PREFIX)) {
    return "tt";
  }
  return null;
}

/**
 * Whether any configured Addon could ever answer for a TMDB Title of this kind.
 *
 * This is the cheap half of the unplayable mark (ADR-0020): the manifests are
 * already in the Snapshot, so a Discover card can say "nothing here can play
 * this" without asking an Addon anything. The rule is the Host's own: a
 * `stream` resource that covers the kind, whose declared prefixes name the
 * `tmdb:` spelling or the `tt` one it bridges to. An Addon that declares
 * neither is never asked, so a feed whose every Addon is like that is marked
 * before anything is pressed.
 */
export function discoverPlayable(
  addons: readonly AddonManifest[],
  kind: DiscoverKind,
): boolean {
  return addons.some((addon) => {
    // The Host reads the first resource named `stream`; a second one is not a
    // second chance to be asked.
    const index = addon.resources.findIndex((resource) => resource.name === "stream");
    if (index < 0) {
      return false;
    }
    const resource = addon.resources[index];
    if (!resource) {
      return false;
    }
    const types = resource.types ?? addon.types;
    return types.includes(kind) && spellingOf(addon, resource) !== null;
  });
}
