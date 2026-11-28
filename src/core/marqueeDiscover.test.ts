import { describe, expect, test } from "vitest";

import { blankFeed } from "./discover";
import {
  ALL_GENRES_OPTION_ID,
  DISCOVER_TYPES,
  INITIAL_DISCOVER_FILTERS,
  discoverEmptyCopy,
  discoverGenreOptions,
  discoverInitialLoading,
  discoverNoKeyCopy,
  discoverSortOptions,
  marqueeDiscoverFeedKey,
  marqueeDiscoverRead,
  reconcileDiscoverFilters,
} from "./marqueeDiscover";

describe("Marquee Discover types, genres, and sorts", () => {
  test("offers single-kind Type choices: Movies then Series", () => {
    expect(DISCOVER_TYPES).toEqual([
      { id: "movie", label: "Movies" },
      { id: "series", label: "Series" },
    ]);
    expect(INITIAL_DISCOVER_FILTERS).toEqual({
      kind: "movie",
      genreId: "all",
      sortId: "popular",
    });
  });

  test("maps Sort options to each kind's valid TMDB sort_by values", () => {
    const movieSorts = discoverSortOptions("host", "movie");
    const seriesSorts = discoverSortOptions("host", "series");

    expect(movieSorts[0]).toEqual({
      id: "popular",
      label: "Most popular",
      sort: "popularity.desc",
    });
    expect(movieSorts.find((opt) => opt.id === "newest")?.sort).toBe(
      "primary_release_date.desc",
    );
    expect(seriesSorts.find((opt) => opt.id === "newest")?.sort).toBe(
      "first_air_date.desc",
    );
    expect(movieSorts.find((opt) => opt.id === "title")?.sort).toBe("title.asc");
    expect(seriesSorts.find((opt) => opt.id === "title")?.sort).toBe("name.asc");
  });

  test("builds per-kind Genre lists starting with All genres", () => {
    const movieGenres = discoverGenreOptions("host", "movie");
    const seriesGenres = discoverGenreOptions("host", "series");

    expect(movieGenres[0]).toEqual({
      id: ALL_GENRES_OPTION_ID,
      label: "All genres",
      tmdbId: null,
      previewName: null,
    });
    expect(movieGenres.some((genre) => genre.label === "Action" && genre.tmdbId === 28)).toBe(
      true,
    );
    expect(movieGenres.some((genre) => genre.label === "Kids")).toBe(false);

    expect(
      seriesGenres.some(
        (genre) => genre.label === "Action & Adventure" && genre.tmdbId === 10759,
      ),
    ).toBe(true);
    expect(seriesGenres.some((genre) => genre.label === "TV Movie")).toBe(false);
  });

  test("reconciles Genre and Sort when switching Type", () => {
    // Horror (27) is movie-only -> resets to All genres when switching to series;
    // semantic sort `newest` stays `newest`.
    expect(
      reconcileDiscoverFilters({
        nextKind: "series",
        genreId: "27",
        sortId: "newest",
        source: "host",
      }),
    ).toEqual({
      kind: "series",
      genreId: "all",
      sortId: "newest",
    });

    // Comedy (35) exists in both movie and series -> stays selected.
    expect(
      reconcileDiscoverFilters({
        nextKind: "series",
        genreId: "35",
        sortId: "rating",
        source: "host",
      }),
    ).toEqual({
      kind: "series",
      genreId: "35",
      sortId: "rating",
    });

    // Preview mode falls back to "popular" if an unsupported sort key arrives.
    expect(
      reconcileDiscoverFilters({
        nextKind: "movie",
        genreId: "Drama",
        sortId: "votes",
        source: "preview",
        previewGenres: ["Action", "Drama"],
      }),
    ).toEqual({
      kind: "movie",
      genreId: "Drama",
      sortId: "popular",
    });
  });
});

describe("Marquee Discover Actions and feed keys", () => {
  test("passes kind, genre, and sort to the discover Action", () => {
    const genres = discoverGenreOptions("host", "movie");
    const sorts = discoverSortOptions("host", "movie");
    const scifi = genres.find((g) => g.label === "Science Fiction")!;
    const rating = sorts.find((s) => s.id === "rating")!;

    const read = marqueeDiscoverRead({
      source: "host",
      kind: "movie",
      genre: scifi,
      sort: rating,
      previewAddonId: "cinemeta",
    });

    expect(read.key).toBe("marquee-discover/host/movie/878/rating");
    expect(read.first).toEqual({
      type: "discover",
      kind: "movie",
      page: 1,
      genre: 878,
      sort: "vote_average.desc",
    });
    expect(read.next({ page: 1, offset: 20 })).toEqual({
      type: "discover",
      kind: "movie",
      page: 2,
      genre: 878,
      sort: "vote_average.desc",
    });
  });

  test("omits genre when All genres is selected, while still passing sort", () => {
    const all = discoverGenreOptions("host", "series")[0]!;
    const popular = discoverSortOptions("host", "series")[0]!;

    const read = marqueeDiscoverRead({
      source: "host",
      kind: "series",
      genre: all,
      sort: popular,
      previewAddonId: "cinemeta",
    });

    expect(read.first).toEqual({
      type: "discover",
      kind: "series",
      page: 1,
      sort: "popularity.desc",
    });
  });

  test("maps preview mode to Cinemeta browse_catalog with genre and skip", () => {
    const genres = discoverGenreOptions("preview", "movie", ["Action", "Drama"]);
    const sorts = discoverSortOptions("preview", "movie");
    const action = genres.find((g) => g.label === "Action")!;
    const rating = sorts.find((s) => s.id === "rating")!;

    const read = marqueeDiscoverRead({
      source: "preview",
      kind: "movie",
      genre: action,
      sort: rating,
      previewAddonId: "cinemeta",
    });

    expect(read.key).toBe(
      marqueeDiscoverFeedKey({
        source: "preview",
        kind: "movie",
        genreId: "Action",
        sortId: "rating",
      }),
    );
    expect(read.first).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "imdbRating" },
      extra: [{ name: "genre", value: "Action" }],
    });
    expect(read.next({ page: 1, offset: 20 })).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "imdbRating" },
      extra: [
        { name: "genre", value: "Action" },
        { name: "skip", value: "20" },
      ],
    });
  });

  test("provides the no-TMDB-key and empty copy", () => {
    expect(discoverNoKeyCopy()).toEqual({
      title: "Discover needs a TMDB key",
      body: "Add your TMDB key in Settings → Credentials to browse TMDB’s catalogue here.",
      actionLabel: "Open Settings",
    });
    expect(
      discoverEmptyCopy({ id: "all", label: "All genres", tmdbId: null, previewName: null })
        .title,
    ).toBe("Nothing is screening here");
    expect(
      discoverEmptyCopy({ id: "27", label: "Horror", tmdbId: 27, previewName: null }).title,
    ).toBe("Nothing in Horror");
    expect(discoverInitialLoading(blankFeed(), "reading")).toBe(true);
    expect(discoverInitialLoading(blankFeed(), "empty")).toBe(false);
  });
});
