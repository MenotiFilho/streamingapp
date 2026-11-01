import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { explain } from "../core/errors";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useSession } from "../core/react/useSession";
import type {
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  MetaPreview,
  Response,
  SearchRow,
  Snapshot,
} from "../core/wire";
import { FakeHost, type HostAnswer, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { Search } from "./Search";
import { titleLevel, type RemotePayload } from "./levels";
import { NO_SEARCHABLE_CATALOGS } from "./searchScreen";

/**
 * Search over a fake HostLink (#207, ADR-0032, docs/agents/testing.md).
 *
 * The screen is the harness; every assertion is a decision at the boundary:
 * what a mount and a submit send, which kind a press pages, the answer a person
 * left, the row that keeps its own failure, and the level a press
 * pushes. Nothing here reads a class or a nesting, and the one line of copy a
 * case reads is the empty state's, taken from the seam that chooses it
 * (docs/agents/testing.md §4).
 */

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };

const FILMS: AddonCatalog = { type: "movie", id: "top", name: "Popular", extra: [SKIP] };
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
  catalogs: [FILMS, SHOWS],
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

function meta(id: string, type: string, name: string): MetaPreview {
  return {
    id,
    type,
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    background: null,
    releaseInfo: "2026",
    imdbRating: null,
    genres: [],
    description: null,
  };
}

function searchAnswer(answer: SearchRow): Response {
  return { snapshots: [], answer: { search: answer } };
}

function catalogRow(
  addon: string,
  type: string,
  id: string,
  metas: MetaPreview[],
): CatalogRow {
  return { addon, type, id, name: id, sent: metas.length, metas, failure: null };
}

/** TMDB's answer: Movies pages on, Series answers one and ends. */
function tmdb(action: Parameters<Respond>[0]): HostAnswer {
  if (action.type !== "search") {
    return { snapshots: [], answer: null };
  }
  if (action.kind === "movie") {
    const answer =
      action.page === 1
        ? {
            type: "movie",
            sent: 2,
            metas: [meta("tmdb:1", "movie", "One"), meta("tmdb:2", "movie", "Two")],
            failure: null,
          }
        : {
            type: "movie",
            sent: 1,
            metas: [meta("tmdb:3", "movie", "Three")],
            failure: null,
          };
    return searchAnswer(answer);
  }
  return searchAnswer({
    type: "series",
    sent: 1,
    metas: [meta("tmdb:s1", "series", "A Show")],
    failure: null,
  });
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
    <Search
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
  respond = tmdb,
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const view = render(<Show link={host} pushes={pushes} />);
  return { host, pushes, view };
}

/** Type a query and press the bar's one control, once the Host's fact has landed. */
async function search(query: string) {
  const input = await screen.findByLabelText("Search for a Title");
  fireEvent.change(input, { target: { value: query } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
}

describe("Search over TMDB", () => {
  test("a mount asks nothing, and a submit asks both kinds for page 1 in the core's order", async () => {
    const { host } = mount();
    await screen.findByLabelText("Search for a Title");
    expect(host.actions, "an unasked screen sends no question").toEqual([]);

    await search("dune");

    await waitFor(() => expect(host.asked("search")).toHaveLength(2));
    expect(host.asked("search")).toEqual([
      { type: "search", query: "dune", kind: "movie", page: 1 },
      { type: "search", query: "dune", kind: "series", page: 1 },
    ]);
  });

  test("an empty or blank field sends nothing", async () => {
    const { host } = mount();
    const form = await screen.findByRole("search");

    fireEvent.submit(form);
    fireEvent.change(screen.getByLabelText("Search for a Title"), {
      target: { value: "   " },
    });
    fireEvent.submit(form);

    expect(host.actions).toEqual([]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("one kind is shown at a time, and More pages that kind alone", async () => {
    const { host } = mount();
    await search("dune");
    await screen.findByTestId("search-card-movie-tmdb:1");

    expect(
      screen.queryByTestId("search-card-series-tmdb:s1"),
      "the row a person is not looking at is held, not drawn",
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More Movies" }));
    await waitFor(() =>
      expect(host.asked("search").at(-1)).toEqual({
        type: "search",
        query: "dune",
        kind: "movie",
        page: 2,
      }),
    );
    await screen.findByTestId("search-card-movie-tmdb:3");
    expect(
      host.asked("search").some(
        (action) => action.kind === "series" && action.page === 2,
      ),
      "the kind a person is not looking at is not paged",
    ).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Series" }));
    expect(await screen.findByTestId("search-card-series-tmdb:s1")).toBeInTheDocument();
    expect(screen.queryByTestId("search-card-movie-tmdb:1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Movies" }));
    expect(await screen.findByTestId("search-card-movie-tmdb:1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("search-card-series-tmdb:s1"),
      "the two rows were held separately, never mixed",
    ).not.toBeInTheDocument();
  });

  test("a kind that failed draws its explanation and leaves the other kind's row alone", async () => {
    const { host } = mount({
      respond: (action) =>
        action.type === "search" && action.kind === "movie"
          ? { kind: "tmdb", detail: "TMDB answered with status 429" }
          : tmdb(action),
    });
    await search("dune");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      explain({ kind: "tmdb", detail: "TMDB answered with status 429" }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Series" }));
    expect(await screen.findByTestId("search-card-series-tmdb:s1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(host.asked("search").map((action) => action.kind)).toEqual([
      "movie",
      "series",
    ]);
  });

  test("an answer to a query a person has left does not land in the new one", async () => {
    const held: Array<() => void> = [];
    const { host } = mount({
      respond: (action) =>
        new Promise<HostAnswer>((resolve) => {
          held.push(() =>
            resolve(
              action.type === "search"
                ? searchAnswer({
                    type: action.kind,
                    sent: 1,
                    metas: [
                      meta(
                        `${action.query}-${action.kind}`,
                        action.kind,
                        action.query,
                      ),
                    ],
                    failure: null,
                  })
                : { snapshots: [], answer: null },
            ),
          );
        }),
    });

    await search("dune");
    await waitFor(() => expect(held).toHaveLength(2));
    await search("matrix");
    await waitFor(() => expect(held).toHaveLength(4));

    act(() => {
      // The query a person left answers last: its cards belong to a row that
      // is no longer on screen.
      held[2]?.();
      held[3]?.();
    });
    await screen.findByTestId("search-card-movie-matrix-movie");
    act(() => {
      held[0]?.();
      held[1]?.();
    });

    await waitFor(() =>
      expect(host.asked("search").map((action) => action.query)).toEqual([
        "dune",
        "dune",
        "matrix",
        "matrix",
      ]),
    );
    expect(screen.getByTestId("search-card-movie-matrix-movie")).toBeInTheDocument();
    expect(
      screen.queryByTestId("search-card-movie-dune-movie"),
      "the left query's answer is dropped, not folded into the new rows",
    ).not.toBeInTheDocument();
  });

  test("a credential cleared drops the keyed rows without taking the other arm", async () => {
    const { host } = mount();
    await search("dune");
    await screen.findByTestId("search-card-movie-tmdb:1");

    act(() => {
      host.publish({
        ...KEYED,
        revision: 2,
        protection: { ...KEYED.protection, tmdbHeld: false },
      });
    });

    await waitFor(() =>
      expect(screen.queryByTestId("search-card-movie-tmdb:1")).not.toBeInTheDocument(),
    );
    expect(
      host.asked("search_catalogs"),
      "the new arm asks only when a person asks it a question",
    ).toEqual([]);
  });
});

describe("Search with no TMDB Credential", () => {
  test("a submit asks the Catalogs once, and the chosen kind narrows the answer", async () => {
    const { host, pushes } = mount({
      snapshot: UNKEYED,
      respond: () => ({
        snapshots: [],
        answer: {
          catalogs: [
            catalogRow("cinemeta", "movie", "top", [meta("tt1", "movie", "One")]),
            catalogRow("shows", "series", "shows", [meta("tt2", "series", "Two")]),
          ],
        },
      }),
    });
    await search("dune");

    await waitFor(() =>
      expect(host.asked("search_catalogs")).toEqual([
        { type: "search_catalogs", query: "dune" },
      ]),
    );
    expect(await screen.findByTestId("search-card-cinemeta-tt1")).toBeInTheDocument();
    expect(screen.queryByTestId("search-card-shows-tt2")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Series" }));
    expect(await screen.findByTestId("search-card-shows-tt2")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("search-card-shows-tt2"));
    expect(pushes).toEqual([
      titleLevel({ addon: "shows", id: "tt2", type: "series", name: "Two" }),
    ]);
  });

  test("no searchable Catalog at all draws the one line that says so", async () => {
    mount({
      snapshot: UNKEYED,
      respond: () => ({ snapshots: [], answer: { catalogs: [] } }),
    });
    await search("dune");

    expect(await screen.findByText(NO_SEARCHABLE_CATALOGS)).toBeInTheDocument();
  });

  test("a refused search draws the Host's words and can be asked again", async () => {
    let refused = false;
    const { host } = mount({
      snapshot: UNKEYED,
      respond: () => {
        if (!refused) {
          refused = true;
          return { kind: "query", detail: "the Host will not search for that" };
        }
        return { snapshots: [], answer: { catalogs: [] } };
      },
    });
    await search("dune");

    expect(await screen.findByRole("alert")).toHaveTextContent(
      explain({ kind: "query", detail: "the Host will not search for that" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Search again" }));

    await waitFor(() => expect(host.asked("search_catalogs")).toHaveLength(2));
    expect(host.asked("search_catalogs")[1]).toEqual({
      type: "search_catalogs",
      query: "dune",
    });
  });
});
