import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { describe, expect, test, vi } from "vitest";

import { explain } from "../core/errors";
import type { NewLevel } from "../core/navigation";
import { Session } from "../core/session";
import type {
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  ContinueEntry,
  DiscoverRow,
  MetaPreview,
  Response,
  Snapshot,
} from "../core/wire";
import { RemoteGrid } from "./RemoteGrid";
import { FakeHost, type HostAnswer, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import type { RemoteGrid as Grid } from "./grid";
import { titleLevel, type RemotePayload } from "./levels";

/**
 * The Remote's whole-row grid (#253, #264, ADR-0032, design system *Rail*).
 *
 * The grid shares the row with its rail and reads on by itself near its end.
 * Every assertion here is a decision — the Action at the Host boundary, the
 * cards a failed page kept, the store one row is shared through, and Back.
 * Nothing reads a class or nesting.
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

const RESUME: ContinueEntry = {
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
  upNext: false,
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
  source: { kind: "continue" },
};

const FEED_KEY = "discover/host/all/movie";

const DISCOVER_GRID: Grid = {
  title: "Movies",
  index: "01",
  tag: "Trending / 2 films",
  addon: null,
  source: {
    kind: "discover",
    feedKind: "movie",
    genreKey: null,
    feedKey: FEED_KEY,
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

function discoverRow(
  metas: MetaPreview[],
  sent = metas.length,
  failure: DiscoverRow["failure"] = null,
): DiscoverRow {
  return { type: "movie", sent, metas, failure };
}

function answer(rows: CatalogRow[]): Response {
  return { snapshots: [], answer: { catalogs: rows } };
}

function discoverAnswer(row: DiscoverRow): Response {
  return { snapshots: [], answer: { discover: [row] } };
}

/** The Home store's first page of four, and one more item at skip=4. */
function homePages(action: Parameters<Respond>[0]): Response {
  if (action.type !== "browse_catalog") {
    return { snapshots: [], answer: null };
  }
  const skip = action.extra.find((extra) => extra.name === "skip")?.value;
  return skip === undefined
    ? answer([
        catalogRow(
          [meta("tt1", "One"), meta("tt2", "Two"), meta("tt3", "Three"), meta("tt4", "Four")],
          4,
        ),
      ])
    : answer([catalogRow([meta("tt5", "Five")], 1)]);
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void };

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((fulfil) => {
    resolve = fulfil;
  });
  return { promise, resolve };
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
  grid = HOME_GRID,
  snapshot = SNAPSHOT,
  respond = homePages,
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
  test("near its end it asks the next page once, and a page in flight is not asked again", async () => {
    const gate = deferred<HostAnswer>();
    let page = 0;
    const host = new FakeHost(SNAPSHOT, (action) => {
      if (action.type !== "discover") {
        return { snapshots: [], answer: null };
      }
      page = action.page;
      return page === 1
        ? discoverAnswer(discoverRow([meta("tmdb:1", "One"), meta("tmdb:2", "Two")]))
        : gate.promise;
    });
    const session = new Session(host);
    const stop = session.start();
    const view = render(
      <Harness grid={DISCOVER_GRID} session={session} pushes={[]} pop={vi.fn()} />,
    );
    try {
      await act(async () => {
        session.feeds.read(
          FEED_KEY,
          { type: "discover", kind: "movie", page: 1 },
          (row) => ({ type: "discover", kind: "movie", page: row.page + 1 }),
        );
      });
      await screen.findByTestId("discover-grid-card-tmdb:1");

      // The two cards do not fill a screen, so the grid is already at its end.
      await waitFor(() =>
        expect(host.asked("discover").filter((action) => action.page === 2)).toHaveLength(1),
      );
      fireEvent.scroll(window);
      await act(async () => {
        await Promise.resolve();
      });
      expect(
        host.asked("discover").filter((action) => action.page === 2),
        "a page in flight is not asked again",
      ).toHaveLength(1);

      gate.resolve(discoverAnswer(discoverRow([], 0)));
      await waitFor(() => expect(session.feeds.feed(FEED_KEY).done).toBe(true));
      fireEvent.scroll(window);
      expect(
        host.asked("discover").filter((action) => action.page === 2),
        "a done row has no next page",
      ).toHaveLength(1);
      expect(page).toBe(2);
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a page that failed keeps its cards and offers the page again", async () => {
    let failures = 0;
    const host = new FakeHost(SNAPSHOT, (action) => {
      if (action.type !== "discover") {
        return { snapshots: [], answer: null };
      }
      if (action.page === 1) {
        return discoverAnswer(discoverRow([meta("tmdb:1", "One")]));
      }
      if (action.page > 2) {
        return discoverAnswer(discoverRow([], 0));
      }
      failures += 1;
      return failures === 1
        ? { kind: "fetch", detail: "timed out" }
        : discoverAnswer(discoverRow([meta("tmdb:2", "Two")]));
    });
    const session = new Session(host);
    const stop = session.start();
    const view = render(
      <Harness grid={DISCOVER_GRID} session={session} pushes={[]} pop={vi.fn()} />,
    );
    try {
      await act(async () => {
        session.feeds.read(
          FEED_KEY,
          { type: "discover", kind: "movie", page: 1 },
          (row) => ({ type: "discover", kind: "movie", page: row.page + 1 }),
        );
      });

      expect(
        await screen.findByTestId("discover-grid-card-tmdb:1"),
        "the page it had is still drawn",
      ).toBeInTheDocument();
      expect(await screen.findByRole("alert")).toHaveTextContent(
        explain({ kind: "fetch", detail: "timed out" }),
      );

      fireEvent.click(screen.getByRole("button", { name: "Try again" }));

      expect(
        await screen.findByTestId("discover-grid-card-tmdb:2"),
      ).toBeInTheDocument();
      expect(host.asked("discover").filter((action) => action.page === 2)).toHaveLength(2);
    } finally {
      view.unmount();
      stop();
    }
  });

  test("Back is the level's own pop", async () => {
    const { pop, view, stop, session } = mount();
    try {
      await act(async () => {
        session.home.sync([{ addon: "cinemeta", catalog: POPULAR }], null);
      });
      fireEvent.click(await screen.findByRole("button", { name: "Back" }));
      expect(pop).toHaveBeenCalledOnce();
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a Home row is read from the Session's store, so the rail and grid share it", async () => {
    const host = new FakeHost(SNAPSHOT, homePages);
    const session = new Session(host);
    const stop = session.start();

    try {
      await waitFor(() => expect(session.getState().snapshot).not.toBeNull());
      act(() => {
        session.home.sync([{ addon: "cinemeta", catalog: POPULAR }], null);
      });
      await waitFor(() =>
        expect(session.home.getSnapshot().rows[0]?.metas).toHaveLength(4),
      );

      const view = render(
        <Harness grid={HOME_GRID} session={session} pushes={[]} pop={vi.fn()} />,
      );

      try {
        // The grid is already at its end, so it reads the next page itself.
        expect(
          await screen.findByTestId("grid-card-cinemeta-tt5"),
        ).toBeInTheDocument();
        expect(
          session.home.getSnapshot().rows[0]?.metas,
          "the page landed in the row the rail draws",
        ).toHaveLength(5);
      } finally {
        view.unmount();
      }
    } finally {
      stop();
    }
  });

  test("a Continue watching grid draws the Host's entries and pages nothing", async () => {
    const { host, view, stop } = mount({
      grid: CONTINUE_GRID,
      snapshot: { ...SNAPSHOT, continueWatching: [RESUME] },
    });
    try {
      expect(await screen.findByTestId("grid-resume-tt1:1:1")).toBeInTheDocument();
      expect(host.asked("browse_catalog")).toEqual([]);
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a Discovered grid draws the feed the rail read", async () => {
    const { view, stop, session } = mount({
      grid: DISCOVER_GRID,
      respond: (action) =>
        action.type === "discover" && action.page === 1
          ? discoverAnswer(discoverRow([meta("tmdb:1", "One")]))
          : { snapshots: [], answer: null },
    });
    try {
      await act(async () => {
        session.feeds.read(
          FEED_KEY,
          { type: "discover", kind: "movie", page: 1 },
          (row) => ({ type: "discover", kind: "movie", page: row.page + 1 }),
        );
      });
      expect(await screen.findByTestId("discover-grid-card-tmdb:1")).toBeInTheDocument();
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a card opens its Title through the Addon that answered the row", async () => {
    const { pushes, view, stop, session } = mount();
    try {
      await act(async () => {
        session.home.sync([{ addon: "cinemeta", catalog: POPULAR }], null);
      });
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
