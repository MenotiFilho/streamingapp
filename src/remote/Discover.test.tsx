import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { explain } from "../core/errors";
import type { HostLink } from "../core/link";
import { useSession } from "../core/react/useSession";
import type { NewLevel } from "../core/navigation";
import type {
  AddonCatalog,
  AddonManifest,
  DiscoverRow,
  MetaPreview,
  Response,
  Snapshot,
} from "../core/wire";
import { Discover } from "./Discover";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import {
  discoverNoCounterpart,
  discoverNote,
  discoverTag,
} from "./discoverScreen";
import { gridLevel } from "./grid";
import { titleLevel, type RemotePayload } from "./levels";

/**
 * Discover over a fake HostLink (#207, ADR-0032, docs/agents/testing.md).
 *
 * The screen is the harness; every assertion is a decision at the boundary: the
 * Actions a mount, a chip or a press sends, the cards a page keeps, one failure
 * path, and the level a press pushes. Nothing here reads a class or a nesting,
 * and the lines of copy a case reads are the ones the seam chooses.
 */

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };

const FILMS: AddonCatalog = { type: "movie", id: "top", name: "Popular", extra: [SKIP] };
const FRESH: AddonCatalog = { type: "movie", id: "new", name: "New", extra: [SKIP] };
const SHOWS: AddonCatalog = { type: "series", id: "shows", name: "Shows", extra: [] };

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [
    { name: "catalog", types: ["movie", "series"], idPrefixes: null },
    { name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] },
  ],
  types: ["movie", "series"],
  catalogs: [FILMS, FRESH, SHOWS],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const KEYED: Snapshot = {
  ...NOTHING,
  addons: [CINEMETA],
  protection: { backend: "file", tmdbHeld: true, stremioHeld: false },
};

const UNKEYED: Snapshot = {
  ...KEYED,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
};

function meta(id: string, name: string): MetaPreview {
  return {
    id,
    type: "movie",
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    background: null,
    releaseInfo: "2026",
    imdbRating: "7.9",
    genres: [],
    description: null,
  };
}

function row(
  metas: MetaPreview[],
  sent = metas.length,
  failure: DiscoverRow["failure"] = null,
): DiscoverRow {
  return { type: "movie", sent, metas, failure };
}

function discoverAnswer(answer: DiscoverRow): Response {
  return { snapshots: [], answer: { discover: [answer] } };
}

function catalogAnswer(
  addon: string,
  type: string,
  id: string,
  metas: MetaPreview[],
  name = id,
): Response {
  return {
    snapshots: [],
    answer: {
      catalogs: [
        { addon, type, id, name, sent: metas.length, metas, failure: null },
      ],
    },
  };
}

/** TMDB's first page of each kind at hand, and one more at page 2. */
function pages(action: Parameters<Respond>[0]): ReturnType<Respond> {
  if (action.type !== "discover") {
    return { snapshots: [], answer: null };
  }
  const at = action.kind === "series" ? "s" : "m";
  if (action.page === 1) {
    return discoverAnswer(
      row([meta(`tmdb:${at}1`, "One"), meta(`tmdb:${at}2`, "Two")]),
    );
  }
  if (action.page === 2) {
    return discoverAnswer(row([meta(`tmdb:${at}3`, "Three")]));
  }
  return discoverAnswer(row([]));
}

function Show({
  link,
  pushes,
}: {
  link: HostLink;
  pushes: NewLevel<RemotePayload>[];
}) {
  const { session, state } = useSession(link);
  return (
    <Discover
      session={session}
      state={state}
      push={(level) => {
        pushes.push(level);
        return `level-${pushes.length}`;
      }}
    />
  );
}

function mount({
  snapshot = KEYED,
  respond = pages,
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const view = render(<Show link={host} pushes={pushes} />);
  return { host, pushes, view };
}

describe("Discover over TMDB", () => {
  test("the first mount asks both kinds' first pages, and draws both rows", async () => {
    const { host } = mount();

    await waitFor(() => expect(host.asked("discover")).toHaveLength(2));
    expect(host.asked("discover")).toEqual([
      { type: "discover", kind: "movie", page: 1 },
      { type: "discover", kind: "series", page: 1 },
    ]);
    expect(host.actions).toHaveLength(2);
    expect(await screen.findByTestId("remote-discover-row-movie")).toBeInTheDocument();
    expect(await screen.findByTestId("remote-discover-row-series")).toBeInTheDocument();
  });

  test("a chosen genre asks both kinds by their own id", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:m1");

    fireEvent.click(screen.getByRole("button", { name: "Science Fiction" }));

    await waitFor(() =>
      expect(host.asked("discover")).toContainEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 878,
      }),
    );
    expect(host.asked("discover")).toContainEqual({
      type: "discover",
      kind: "series",
      page: 1,
      genre: 10765,
    });
    expect(
      screen.queryByRole("button", { name: "Movie" }),
      "Discover has no kind chips",
    ).not.toBeInTheDocument();
  });

  test("a film-only genre empties the Series row with its line, and asks only Movies", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:s1");
    const seriesAsked = host
      .asked("discover")
      .filter((action) => action.kind === "series").length;

    fireEvent.click(screen.getByRole("button", { name: "TV Movie" }));

    await waitFor(() =>
      expect(host.asked("discover")).toContainEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 10770,
      }),
    );
    expect(
      host.asked("discover").filter((action) => action.kind === "series"),
      "an ask without the genre would answer the unfiltered feed",
    ).toHaveLength(seriesAsked);

    const series = screen.getByTestId("remote-discover-row-series");
    expect(
      within(series).getByText(discoverNoCounterpart("series", "TV Movie")),
    ).toBeInTheDocument();
    expect(
      within(series).queryByTestId("discover-card-tmdb:s1"),
    ).not.toBeInTheDocument();
  });

  test("each row's More opens that row as a whole-row grid and asks no page itself", async () => {
    const { host, pushes } = mount();
    await screen.findByTestId("discover-card-tmdb:s2");
    const asked = host.asked("discover").length;

    fireEvent.click(screen.getByRole("button", { name: "More Movies" }));
    expect(pushes.at(-1)).toEqual(
      gridLevel({
        title: "Movies",
        index: "01",
        tag: discoverTag("movie", null, 2),
        addon: null,
        source: {
          kind: "discover",
          feedKind: "movie",
          genre: null,
          feed: {
            page: 1,
            items: [meta("tmdb:m1", "One"), meta("tmdb:m2", "Two")],
            failure: null,
            done: false,
          },
        },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "More Series" }));
    expect(pushes.at(-1)?.name).toBe("All of Series");
    expect(
      host.asked("discover"),
      "the page is the grid's head action's, not the More card's",
    ).toHaveLength(asked);
  });

  test("each rail's head action asks its own kind's next page into the same cards", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:m2");

    const movies = screen.getByTestId("remote-discover-row-movie");
    fireEvent.click(within(movies).getByRole("button", { name: "Read on" }));

    await waitFor(() =>
      expect(host.asked("discover").at(-1)).toEqual({
        type: "discover",
        kind: "movie",
        page: 2,
      }),
    );
    expect(await screen.findByTestId("discover-card-tmdb:m3")).toBeInTheDocument();
    expect(
      screen.getByTestId("discover-card-tmdb:m1"),
      "the cards already read keep their place",
    ).toBeInTheDocument();
    expect(
      host.asked("discover").filter((action) => action.kind === "series"),
      "the other row was not paged",
    ).toHaveLength(1);
  });

  test("a row that answered nothing draws its quiet line and offers no more", async () => {
    mount({
      respond: (action) => {
        if (action.type !== "discover") {
          return { snapshots: [], answer: null };
        }
        return action.kind === "movie"
          ? discoverAnswer(row([]))
          : discoverAnswer(row([meta("tmdb:s1", "One")]));
      },
    });

    const movies = await screen.findByTestId("remote-discover-row-movie");
    expect(
      within(movies).getByText(discoverNote("empty", null) ?? ""),
    ).toBeInTheDocument();
    expect(
      within(movies).queryByRole("button", { name: "More Movies" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "More Series" }),
      "the other row keeps its own way on",
    ).toBeInTheDocument();
  });

  test("a press pushes the Discovered Title level and asks the Host nothing more", async () => {
    const { host, pushes } = mount();
    const card = await screen.findByTestId("discover-card-tmdb:m1");

    fireEvent.click(card);

    expect(pushes).toEqual([
      titleLevel({ addon: null, id: "tmdb:m1", type: "movie", name: "One" }),
    ]);
    expect(
      host.actions.some(
        (action) =>
          action.type === "open_title" || action.type === "open_discovered_title",
      ),
      "B3 opens a level; the Title request is B6's",
    ).toBe(false);
  });
});

describe("Discover with no TMDB Credential", () => {
  test("the first mount asks every Catalog of both kinds, in the Addons' order", async () => {
    const { host } = mount({
      snapshot: UNKEYED,
      respond: (action) =>
        action.type === "browse_catalog"
          ? catalogAnswer("cinemeta", action.catalog.type, action.catalog.id, [
              meta(`tt-${action.catalog.id}`, "One"),
            ])
          : { snapshots: [], answer: null },
    });

    await waitFor(() => expect(host.asked("browse_catalog")).toHaveLength(3));
    expect(host.asked("browse_catalog").map((action) => action.catalog.id)).toEqual([
      "top",
      "new",
      "shows",
    ]);
    expect(host.asked("browse_catalog")[0]).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [],
    });
    expect(
      host.asked("discover"),
      "with no credential there is no TMDB feed to ask for",
    ).toEqual([]);
    expect(
      screen.queryByRole("button", { name: "Movie" }),
      "the keyless arm has no kind chips either",
    ).not.toBeInTheDocument();
  });

  test("a Catalog row's head action asks the page after what it read", async () => {
    const { host } = mount({
      snapshot: UNKEYED,
      respond: (action) => {
        if (action.type !== "browse_catalog") {
          return { snapshots: [], answer: null };
        }
        return catalogAnswer(
          "cinemeta",
          action.catalog.type,
          action.catalog.id,
          [meta(`tt-${action.catalog.id}`, "One")],
          action.catalog.id === "top" ? "Popular" : "New",
        );
      },
    });
    const rail = await screen.findByTestId("discover-row-cinemeta/movie/top");
    await waitFor(() => expect(within(rail).getByTestId("discover-card-tt-top")).toBeInTheDocument());

    fireEvent.click(within(rail).getByRole("button", { name: "Read on" }));

    await waitFor(() =>
      expect(host.asked("browse_catalog").at(-1)).toEqual({
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "movie", id: "top" },
        extra: [{ name: "skip", value: "1" }],
      }),
    );
  });

  test("a Catalog's More card opens its row as a grid, carrying what it read", async () => {
    const { host, pushes } = mount({
      snapshot: UNKEYED,
      respond: (action) => {
        if (action.type !== "browse_catalog") {
          return { snapshots: [], answer: null };
        }
        return catalogAnswer(
          "cinemeta",
          action.catalog.type,
          action.catalog.id,
          [meta(`tt-${action.catalog.id}`, "One")],
          action.catalog.id === "top" ? "Popular" : "New",
        );
      },
    });
    await waitFor(() => expect(host.asked("browse_catalog")).toHaveLength(3));
    const asked = host.asked("browse_catalog").length;

    fireEvent.click(screen.getByRole("button", { name: "More Popular" }));

    expect(pushes).toEqual([
      gridLevel({
        title: "Popular",
        index: "01",
        tag: "Cinemeta / 1 film",
        addon: "cinemeta",
        source: {
          kind: "catalog",
          row: {
            addon: "cinemeta",
            type: "movie",
            id: "top",
            name: "Popular",
            metas: [meta("tt-top", "One")],
            offset: 1,
            failure: null,
            done: false,
          },
        },
      }),
    ]);
    expect(
      host.asked("browse_catalog"),
      "the grid asks the next page from its head, not from the More card",
    ).toHaveLength(asked);
  });

  test("a press carries the Addon whose Catalog answered", async () => {
    const { pushes } = mount({
      snapshot: UNKEYED,
      respond: (action) =>
        action.type === "browse_catalog"
          ? catalogAnswer("cinemeta", action.catalog.type, action.catalog.id, [
              meta(`tt-${action.catalog.id}`, "One"),
            ])
          : { snapshots: [], answer: null },
    });

    fireEvent.click(await screen.findByTestId("discover-card-tt-top"));

    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt-top", type: "movie", name: "One" }),
    ]);
  });

  test("a credential cleared draws the Catalogs of both kinds instead of the TMDB rows", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:s1");

    act(() => {
      host.publish({
        ...KEYED,
        revision: 2,
        protection: { ...KEYED.protection, tmdbHeld: false },
      });
    });

    await waitFor(() => expect(host.asked("browse_catalog").length).toBe(3));
    expect(
      host.asked("browse_catalog").map((action) => action.catalog.type),
      "the new arm draws every Catalog, not just the kind the old one showed",
    ).toEqual(["movie", "movie", "series"]);
    expect(
      screen.queryByRole("button", { name: "All genres" }),
      "the genre row is TMDB's and steps aside with the credential",
    ).not.toBeInTheDocument();
  });

  test("a Catalog the Host refused draws the Host's words", async () => {
    mount({
      snapshot: UNKEYED,
      respond: (action) => {
        if (action.type !== "browse_catalog") {
          return { snapshots: [], answer: null };
        }
        if (action.catalog.id === "top") {
          return { kind: "fetch", detail: "timed out" };
        }
        return catalogAnswer("cinemeta", action.catalog.type, action.catalog.id, [
          meta(`tt-${action.catalog.id}`, "One"),
        ]);
      },
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(explain({ kind: "fetch", detail: "timed out" }));
    expect(await screen.findByTestId("discover-card-tt-new")).toBeInTheDocument();
  });
});
