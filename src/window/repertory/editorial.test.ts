import { describe, expect, test } from "vitest";

import { blankFeed, feedWith, MOVIE, type DiscoverFeed } from "../../core/discover";
import { SERIES } from "../../core/title";
import {
  discoverEmptyNote,
  discoverNoKey,
  discoverTag,
  feedMore,
  feedState,
  genresFor,
  previewDiscoverAsk,
} from "./editorial";

const ACTION = { key: "28", name: "Action", value: 28 };

function feed(overrides: Partial<DiscoverFeed> = {}): DiscoverFeed {
  return { ...blankFeed(), ...overrides };
}

describe("Discover's genres", () => {
  test("the Host is asked by TMDB's own id for the kind", () => {
    const films = genresFor("host", MOVIE);
    const series = genresFor("host", SERIES);

    expect(films[0]).toEqual(ACTION);
    expect(series[0]).toEqual({ key: "10759", name: "Action & Adventure", value: 10759 });
    expect(films.map((genre) => genre.name)).not.toEqual(
      series.map((genre) => genre.name),
    );
  });

  test("the preview is asked by Cinemeta's own genre name", () => {
    expect(genresFor("preview", MOVIE)[0]).toEqual({
      key: "Action",
      name: "Action",
      value: "Action",
    });
    expect(genresFor("preview", SERIES).map((genre) => genre.name)).toContain(
      "Sci-Fi",
    );
  });
});

describe("the preview's Discover ask", () => {
  test("with no genre the first page is Cinemeta's Popular catalogue", () => {
    expect(previewDiscoverAsk(MOVIE, null, 0)).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [],
    });
  });

  test("a genre travels by the Addon's own name and the page by skip", () => {
    expect(previewDiscoverAsk(SERIES, genresFor("preview", SERIES)[0]!, 40)).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "series", id: "top" },
      extra: [
        { name: "genre", value: "Action" },
        { name: "skip", value: "40" },
      ],
    });
  });
});

describe("a feed's paging and state", () => {
  test("More is offered only after a first page, or to retry a failed one", () => {
    expect(feedMore(feed())).toBe(false);
    expect(feedMore(feed({ failure: { kind: "fetch", detail: "down" } }))).toBe(true);
    expect(feedMore(feed({ page: 1 }))).toBe(true);
    expect(feedMore(feed({ page: 1, done: true }))).toBe(false);
  });

  test("a first page reads, a later page reads on, and a failed page is a failure", () => {
    expect(feedState(feed(), true)).toBe("reading");
    expect(feedState(feed({ page: 1 }), true)).toBe("reading-more");
    expect(feedState(feed({ failure: { kind: "fetch", detail: "down" } }), false)).toBe(
      "failed",
    );
  });

  test("an empty feed is only empty after the Addon answered nothing", () => {
    expect(feedState(feed(), false)).toBe("ready");
    expect(feedState(feed({ done: true }), false)).toBe("empty");
    expect(
      feedState(
        feed({ items: [{ ...meta(), id: "tt1" }] }),
        false,
      ),
    ).toBe("ready");
  });
});

describe("the editorial row's bookkeeping", () => {
  test("the tag names the filter or Trending, and the count the kind prints", () => {
    expect(discoverTag(MOVIE, null, 20)).toBe("Trending / 20 films");
    expect(discoverTag(SERIES, null, 1)).toBe("Trending / 1 series");
    expect(discoverTag(MOVIE, ACTION, 3)).toBe("Action / 3 films");
  });

  test("the no-key state names what powers Discover and where the key goes", () => {
    expect(discoverNoKey()).toEqual({
      title: "Discover is powered by TMDB",
      body:
        "TMDB supplies the weekly Trending feed and the genres it can be filtered by. Add a TMDB API key in Settings → Credentials to browse it.",
      action: "Open Settings → Credentials",
    });
  });

  test("an empty feed says what a person can do about it", () => {
    expect(discoverEmptyNote(null)).toBe("Nothing is screening in this feed.");
    expect(discoverEmptyNote(ACTION)).toBe(
      "Nothing is screening under Action. Choose another genre.",
    );
  });
});

describe("a page folded into a feed", () => {
  test("a successful page advances the feed and the next More asks the next one", () => {
    const once = feedWith(feed(), {
      type: MOVIE,
      sent: 2,
      metas: [meta("tt1"), meta("tt2")],
      failure: null,
    });

    expect(once.page).toBe(1);
    expect(once.items).toHaveLength(2);
    expect(feedMore(once)).toBe(true);
  });
});

function meta(id = "tt0133093") {
  return {
    id,
    type: MOVIE,
    name: "The Matrix",
    poster: null,
    posterShape: null,
    background: null,
    releaseInfo: "1999",
    imdbRating: "8.7",
    genres: ["Action"],
    description: null,
  };
}
