import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, expect, test, vi } from "vitest";

import type { Row } from "../core/browse";
import { blankFeed } from "../core/discover";
import { explain } from "../core/errors";
import type { NewLevel } from "../core/navigation";
import { Session } from "../core/session";
import type {
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  MetaPreview,
  Response,
  ResumeEntry,
  Snapshot,
} from "../core/wire";
import { RemoteGrid } from "./RemoteGrid";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import type { RemoteGrid as Grid } from "./grid";
import { titleLevel, type RemotePayload } from "./levels";

/**
 * The Remote's whole-row grid (#253, ADR-0032).
 *
 * The grid is drawn over a real Session with a fake Host: every assertion is a
 * decision — the cards the row has read, the Action its head asks, the store
 * one row is shared through, and Back. Nothing here reads a class or a nesting.
 */

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };

const POPULAR: AddonCatalog = {
  type: "movie",
  id: "top",
  name: "Popular",
  extra: [SKIP],
};

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [POPULAR],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const SNAPSHOT: Snapshot = { ...NOTHING, addons: [CINEMETA] };

const RESUME: ResumeEntry = {
  video: { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null },
  title: {
    addon: "cinemeta",
    id: "tt1",
    type: "series",
    name: "One",
    poster: null,
    background: null,
  },
  position: 300,
  duration: 600,
  watched: false,
  unplayable: null,
};

function meta(id: string, name: string): MetaPreview {
  return {
    id,
    type: "movie",
    name,
    poster: null,
    posterShape: "poster",
    background: null,
    releaseInfo: "2026",
    imdbRating: null,
    genres: [],
    description: null,
  };
}

const ROW: Row = {
  addon: "cinemeta",
  type: "movie",
  id: "top",
  name: "Popular",
  metas: [meta("tt1", "One"), meta("tt2", "Two")],
  offset: 2,
  failure: null,
  done: false,
};

const CATALOG_GRID: Grid = {
  title: "Popular",
  index: "02",
  tag: "Cinemeta / 2 films",
  addon: "cinemeta",
  source: { kind: "catalog", row: ROW },
};

const HOME_GRID: Grid = {
  title: "Popular",
  index: "02",
  tag: null,
  addon: "cinemeta",
  source: { kind: "home", rowKey: "cinemeta/movie/top" },
};

const CONTINUE_GRID: Grid = {
  title: "Continue watching",
  index: "01",
  tag: "1 in progress",
  addon: null,
  source: { kind: "home", rowKey: null },
};

const DISCOVER_GRID: Grid = {
  title: "Movies",
  index: "01",
  tag: "Trending / 2 films",
  addon: null,
  source: {
    kind: "discover",
    feedKind: "movie",
    genre: null,
    feed: {
      ...blankFeed(),
      page: 1,
      items: [meta("tmdb:1", "One"), meta("tmdb:2", "Two")],
    },
  },
};

function catalogRow(
  metas: MetaPreview[],
  sent = metas.length,
  failure: CatalogRow["failure"] = null,
): CatalogRow {
  return {
    addon: "cinemeta",
    type: "movie",
    id: "top",
    name: "Popular",
    sent,
    metas,
    failure,
  };
}

function answer(rows: CatalogRow[]): Response {
  return { snapshots: [], answer: { catalogs: rows } };
}

/** The Host's first page, and one more page at skip=2. */
function pages(action: Parameters<Respond>[0]): Response {
  if (action.type !== "browse_catalog") {
    return { snapshots: [], answer: null };
  }
  const skip = action.extra.find((extra) => extra.name === "skip")?.value;
  if (skip === undefined) {
    return answer([catalogRow(ROW.metas, 2)]);
  }
  return answer([catalogRow([meta("tt3", "Three")], 1)]);
}

/**
 * The grid over a Session the test holds, subscribed as the room subscribes:
 * a Snapshot the Host answers with is a re-render, not a value read once.
 */
function Harness({
  grid,
  session,
  pushes,
  pop,
}: {
  grid: Grid;
  session: Session;
  pushes: NewLevel<RemotePayload>[];
  pop: () => void;
}) {
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return (
    <RemoteGrid
      grid={grid}
      session={session}
      state={state}
      push={(level) => {
        pushes.push(level);
        return `level-${pushes.length}`;
      }}
      pop={pop}
    />
  );
}

function mount({
  grid = CATALOG_GRID,
  snapshot = SNAPSHOT,
  respond = pages,
}: {
  grid?: Grid;
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const session = new Session(host);
  const stop = session.start();
  const pushes: NewLevel<RemotePayload>[] = [];
  const pop = vi.fn();
  const view = render(
    <Harness grid={grid} session={session} pushes={pushes} pop={pop} />,
  );
  return { host, session, pushes, pop, view, stop };
}

describe("the whole-row grid", () => {
  test("draws the cards the rail already read and asks nothing to open", async () => {
    const { host, view, stop } = mount();
    try {
      expect(screen.getByTestId("grid-card-cinemeta-tt1")).toBeInTheDocument();
      expect(screen.getByTestId("grid-card-cinemeta-tt2")).toBeInTheDocument();

      await act(async () => {
        await Promise.resolve();
      });

      expect(
        host.asked("browse_catalog"),
        "opening the grid is not a page of the grid's own",
      ).toEqual([]);
    } finally {
      view.unmount();
      stop();
    }
  });

  test("its head action asks the same row's next page and appends the cards", async () => {
    const { host, view, stop } = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Read on" }));

      await waitFor(() =>
        expect(host.asked("browse_catalog")).toEqual([
          {
            type: "browse_catalog",
            addon: "cinemeta",
            catalog: { type: "movie", id: "top" },
            extra: [{ name: "skip", value: "2" }],
          },
        ]),
      );
      expect(
        await screen.findByTestId("grid-card-cinemeta-tt3"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("grid-card-cinemeta-tt1"),
        "the cards already read keep their place",
      ).toBeInTheDocument();
    } finally {
      view.unmount();
      stop();
    }
  });

  test("Back is the level's own pop", async () => {
    const { pop, view, stop } = mount();
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Back" }));
      expect(pop).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a Home row is read from the Session's store, so the rail and grid share it", async () => {
    const host = new FakeHost(SNAPSHOT, pages);
    const session = new Session(host);
    const stop = session.start();
    const pushes: NewLevel<RemotePayload>[] = [];
    const pop = vi.fn();

    try {
      await waitFor(() => expect(session.getState().snapshot).not.toBeNull());
      act(() => {
        session.home.sync([{ addon: "cinemeta", catalog: POPULAR }], null);
      });
      await waitFor(() =>
        expect(session.home.getSnapshot().rows[0]?.metas).toHaveLength(2),
      );

      const view = render(
        <Harness grid={HOME_GRID} session={session} pushes={pushes} pop={pop} />,
      );

      try {
        fireEvent.click(await screen.findByRole("button", { name: "Read on" }));
        expect(
          await screen.findByTestId("grid-card-cinemeta-tt3"),
        ).toBeInTheDocument();
        expect(
          session.home.getSnapshot().rows[0]?.metas,
          "the page landed in the row the rail draws",
        ).toEqual([meta("tt1", "One"), meta("tt2", "Two"), meta("tt3", "Three")]);
      } finally {
        view.unmount();
      }
    } finally {
      stop();
    }
  });

  test("a Continue watching grid draws the Host's entries and offers no page", async () => {
    const { view, stop } = mount({
      grid: CONTINUE_GRID,
      snapshot: { ...SNAPSHOT, watchProgress: [RESUME] },
    });
    try {
      expect(await screen.findByTestId("grid-resume-tt1:1:1")).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Read on" }),
      ).not.toBeInTheDocument();
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a failed Discover page keeps its cards, says why, and asks that page again", async () => {
    let failed = false;
    const { host, view, stop } = mount({
      grid: DISCOVER_GRID,
      respond: (action) => {
        if (action.type !== "discover") {
          return { snapshots: [], answer: null };
        }
        if (!failed) {
          failed = true;
          return { kind: "tmdb", detail: "TMDB answered with status 429" };
        }
        return {
          snapshots: [],
          answer: {
            discover: [
              { type: "movie", sent: 1, metas: [meta("tmdb:3", "Three")], failure: null },
            ],
          },
        };
      },
    });
    try {
      fireEvent.click(await screen.findByRole("button", { name: "Read on" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        explain({ kind: "tmdb", detail: "TMDB answered with status 429" }),
      );
      expect(
        screen.getByTestId("discover-grid-card-tmdb:1"),
        "the page that failed did not wipe what was read",
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
      expect(
        await screen.findByTestId("discover-grid-card-tmdb:3"),
      ).toBeInTheDocument();
      expect(host.asked("discover").map((action) => action.page)).toEqual([2, 2]);
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a row whose Catalog declares no skip has no head action", async () => {
    const { view, stop } = mount({
      snapshot: {
        ...SNAPSHOT,
        addons: [{ ...CINEMETA, catalogs: [{ ...POPULAR, extra: [] }] }],
      },
    });
    try {
      expect(await screen.findByRole("button", { name: "Back" })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Read on" }),
      ).not.toBeInTheDocument();
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a card opens its Title through the Addon that answered the row", async () => {
    const { pushes, view, stop } = mount();
    try {
      fireEvent.click(await screen.findByTestId("grid-card-cinemeta-tt1"));
      expect(pushes).toEqual([
        titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }),
      ]);
    } finally {
      view.unmount();
      stop();
    }
  });
});
