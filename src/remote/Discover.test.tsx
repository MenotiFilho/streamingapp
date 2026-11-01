import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { discoverNote } from "./discoverScreen";
import { titleLevel, type RemotePayload } from "./levels";

/**
 * Discover over a fake HostLink (#207, ADR-0032, docs/agents/testing.md).
 *
 * The screen is the harness; every assertion is a decision at the boundary: the
 * Action a mount, a chip or a press sends, the cards a page keeps, one failure
 * path, and the level a press pushes. Nothing here reads a class or a nesting,
 * and the one line of copy a case reads is the empty state's, taken from the
 * seam that chooses it (docs/agents/testing.md §4).
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

/** TMDB's first page at hand, and one more at every page after it. */
function pages(action: Parameters<Respond>[0]): ReturnType<Respond> {
  if (action.type !== "discover") {
    return { snapshots: [], answer: null };
  }
  if (action.page === 1) {
    return discoverAnswer(row([meta("tmdb:1", "One"), meta("tmdb:2", "Two")]));
  }
  if (action.page === 2) {
    return discoverAnswer(row([meta("tmdb:3", "Three")]));
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
  test("the first mount asks the landing kind's first page and nothing else", async () => {
    const { host } = mount();

    await waitFor(() => expect(host.asked("discover")).toHaveLength(1));
    expect(host.asked("discover")[0]).toEqual({
      type: "discover",
      kind: "movie",
      page: 1,
    });
    expect(host.actions).toHaveLength(1);
  });

  test("a chosen genre starts the feed over and asks by TMDB's numeric id", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:1");

    fireEvent.click(screen.getByRole("button", { name: "Science Fiction" }));

    await waitFor(() =>
      expect(host.asked("discover").at(-1)).toEqual({
        type: "discover",
        kind: "movie",
        page: 1,
        genre: 878,
      }),
    );
  });

  test("a kind change asks the other kind's first page and drops the genre", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:1");
    fireEvent.click(screen.getByRole("button", { name: "Action" }));
    await waitFor(() =>
      expect(host.asked("discover").at(-1)).toMatchObject({ genre: 28 }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Series" }));

    await waitFor(() =>
      expect(host.asked("discover").at(-1)).toEqual({
        type: "discover",
        kind: "series",
        page: 1,
      }),
    );
    expect(
      screen.queryByRole("button", { name: "Action" }),
      "a film's genre is not a series' filter: the series rail is TMDB's own",
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Action & Adventure" }),
    ).toBeInTheDocument();
  });

  test("More asks the next page and keeps the cards already read", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:2");

    fireEvent.click(screen.getByRole("button", { name: "More Movies" }));

    await waitFor(() =>
      expect(host.asked("discover").at(-1)).toEqual({
        type: "discover",
        kind: "movie",
        page: 2,
      }),
    );
    await screen.findByTestId("discover-card-tmdb:3");
    expect(screen.getByTestId("discover-card-tmdb:1")).toBeInTheDocument();
  });

  test("a failed page keeps its cards and the same press asks that page again", async () => {
    let failed = false;
    const { host } = mount({
      respond: (action) => {
        if (action.type === "discover" && action.page === 2 && !failed) {
          failed = true;
          return { kind: "tmdb", detail: "TMDB answered with status 429" };
        }
        return pages(action);
      },
    });
    await screen.findByTestId("discover-card-tmdb:1");

    fireEvent.click(screen.getByRole("button", { name: "More Movies" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      explain({ kind: "tmdb", detail: "TMDB answered with status 429" }),
    );
    expect(
      screen.getByTestId("discover-card-tmdb:1"),
      "the page that failed did not wipe what was read",
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "More Movies" }));
    await screen.findByTestId("discover-card-tmdb:3");
    expect(host.asked("discover").map((action) => action.page)).toEqual([1, 2, 2]);
  });

  test("a feed that answered nothing draws its quiet line and offers no more", async () => {
    mount({ respond: () => discoverAnswer(row([])) });

    expect(
      await screen.findByText(discoverNote("empty", null) ?? ""),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "More Movies" })).not.toBeInTheDocument();
  });

  test("a press pushes the Discovered Title level and asks the Host nothing more", async () => {
    const { host, pushes } = mount();
    const card = await screen.findByTestId("discover-card-tmdb:1");

    fireEvent.click(card);

    expect(pushes).toEqual([
      titleLevel({ addon: null, id: "tmdb:1", type: "movie", name: "One" }),
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
  test("the first mount asks every Catalog of the kind, in the Addons' order", async () => {
    const { host } = mount({
      snapshot: UNKEYED,
      respond: () => catalogAnswer("cinemeta", "movie", "top", [meta("tt1", "One")]),
    });

    await waitFor(() => expect(host.asked("browse_catalog")).toHaveLength(2));
    expect(host.asked("browse_catalog").map((action) => action.catalog.id)).toEqual([
      "top",
      "new",
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
  });

  test("a kind change asks the other kind's Catalogs", async () => {
    const { host } = mount({
      snapshot: UNKEYED,
      respond: (action) =>
        catalogAnswer(
          "cinemeta",
          action.type === "browse_catalog" ? action.catalog.type : "",
          action.type === "browse_catalog" ? action.catalog.id : "",
          [meta("tt-s", "A Show")],
        ),
    });
    await waitFor(() => expect(host.asked("browse_catalog")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "Series" }));

    await waitFor(() =>
      expect(host.asked("browse_catalog").at(-1)).toEqual({
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "series", id: "shows" },
        extra: [],
      }),
    );
  });

  test("a Catalog's row pages on by the skip it has read to", async () => {
    const { host } = mount({
      snapshot: UNKEYED,
      respond: (action) => {
        if (action.type !== "browse_catalog") {
          return { snapshots: [], answer: null };
        }
        const skip = action.extra.find((extra) => extra.name === "skip")?.value;
        return catalogAnswer(
          "cinemeta",
          action.catalog.type,
          action.catalog.id,
          skip
            ? [meta(`tt-${action.catalog.id}-more`, "More")]
            : [meta(`tt-${action.catalog.id}`, "One")],
          action.catalog.id === "top" ? "Popular" : "New",
        );
      },
    });
    await waitFor(() => expect(host.asked("browse_catalog")).toHaveLength(2));

    fireEvent.click(screen.getByRole("button", { name: "More Popular" }));

    await waitFor(() =>
      expect(host.asked("browse_catalog")).toContainEqual({
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "movie", id: "top" },
        extra: [{ name: "skip", value: "1" }],
      }),
    );
  });

  test("a press carries the Addon whose Catalog answered", async () => {
    const { pushes } = mount({
      snapshot: UNKEYED,
      respond: (action) =>
        catalogAnswer(
          "cinemeta",
          "movie",
          action.type === "browse_catalog" ? action.catalog.id : "top",
          [
            meta(
              `tt-${action.type === "browse_catalog" ? action.catalog.id : "top"}`,
              "One",
            ),
          ],
        ),
    });

    fireEvent.click(await screen.findByTestId("discover-card-tt-top"));

    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt-top", type: "movie", name: "One" }),
    ]);
  });

  test("a credential cleared starts the new arm on Movie, without asking the kind left behind", async () => {
    const { host } = mount();
    await screen.findByTestId("discover-card-tmdb:1");
    fireEvent.click(screen.getByRole("button", { name: "Series" }));
    await waitFor(() =>
      expect(host.asked("discover").at(-1)).toMatchObject({ kind: "series" }),
    );

    act(() => {
      host.publish({
        ...KEYED,
        revision: 2,
        protection: { ...KEYED.protection, tmdbHeld: false },
      });
    });

    await waitFor(() => expect(host.asked("browse_catalog").length).toBe(2));
    expect(
      host.asked("browse_catalog").map((action) => action.catalog.type),
      "the new arm mounts on the landing kind, not on the one the old arm was left on",
    ).toEqual(["movie", "movie"]);
  });

  test("a Catalog the Host refused draws the Host's words", async () => {
    mount({
      snapshot: UNKEYED,
      respond: (action) =>
        action.type === "browse_catalog" && action.catalog.id === "top"
          ? { kind: "fetch", detail: "timed out" }
          : catalogAnswer("cinemeta", "movie", "new", [meta("tt2", "Two")]),
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(explain({ kind: "fetch", detail: "timed out" }));
    expect(await screen.findByTestId("discover-card-tt2")).toBeInTheDocument();
  });
});
