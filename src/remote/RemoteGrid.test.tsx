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
 * The Remote's whole-row grid (#253, ADR-0032, design system *Rail*).
 *
 * The grid is static: it draws the cards the rail has read and asks no page of
 * its own. Paging is the rail's, and its own tests hold that. Every assertion
 * here is a decision — the cards the row has read, no Action on opening, the
 * store one row is shared through, and Back. Nothing reads a class or nesting.
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
  source: { kind: "continue" },
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
        "the grid asks no page of its own",
      ).toEqual([]);
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
        // The rail's head action is the one that pages; a page landing in the
        // store is a page the open grid draws.
        act(() => session.home.page("cinemeta/movie/top"));

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

  test("a Continue watching grid draws the Host's entries and pages nothing", async () => {
    const { host, view, stop } = mount({
      grid: CONTINUE_GRID,
      snapshot: { ...SNAPSHOT, watchProgress: [RESUME] },
    });
    try {
      expect(await screen.findByTestId("grid-resume-tt1:1:1")).toBeInTheDocument();
      expect(host.asked("browse_catalog")).toEqual([]);
    } finally {
      view.unmount();
      stop();
    }
  });

  test("a Discovered grid draws the feed it was handed, and its failure where the rail said it", async () => {
    const failure = { kind: "tmdb", detail: "TMDB answered with status 429" } as const;
    const grid: Grid = {
      ...DISCOVER_GRID,
      source: {
        kind: "discover",
        feedKind: "movie",
        genre: null,
        feed: {
          ...blankFeed(),
          page: 1,
          items: [meta("tmdb:1", "One")],
          failure,
        },
      },
    };
    const { host, view, stop } = mount({ grid });
    try {
      expect(screen.getByTestId("discover-grid-card-tmdb:1")).toBeInTheDocument();
      expect(screen.getByRole("alert")).toHaveTextContent(explain(failure));
      expect(host.asked("discover"), "the grid does not ask a page").toEqual([]);
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
