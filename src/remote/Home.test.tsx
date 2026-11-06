import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useSyncExternalStore } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { explain } from "../core/errors";
import type { ActionError } from "../core/errors";
import type { Row } from "../core/browse";
import type { Destination } from "../core/destinations";
import { FEATURE_ROTATION_MS, rowTag } from "../core/homeProgramme";
import type { HostLink, LinkState } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useSession } from "../core/react/useSession";
import { Session } from "../core/session";
import type {
  Action,
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  MetaPreview,
  Response,
  ResumeEntry,
  Snapshot,
} from "../core/wire";
import { Home } from "./Home";
import { NOTHING } from "./fakeSocket.testing";
import { gridLevel } from "./grid";
import { titleLevel, type RemotePayload } from "./levels";

/**
 * Home over a fake HostLink (ADR-0032, docs/agents/testing.md).
 *
 * The screen is the harness; every assertion is a decision: the `browse_catalog`
 * Actions at the boundary, the rows that survive a Catalog change, the one that
 * refused, the beat the core sets, and the level a press pushes. Nothing here
 * reads a class, a nesting or a rendered line of copy.
 */

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };

const POPULAR: AddonCatalog = { type: "movie", id: "top", name: "Popular", extra: [SKIP] };
const FRESH: AddonCatalog = { type: "movie", id: "new", name: "New", extra: [SKIP] };
const OTHER: AddonCatalog = { type: "movie", id: "other", name: "Other", extra: [SKIP] };

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [POPULAR, FRESH],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const SNAPSHOT: Snapshot = {
  ...NOTHING,
  addons: [CINEMETA],
  featuredCatalog: { addon: "cinemeta", catalog: { type: "movie", id: "top" } },
};

function meta(id: string, name: string): MetaPreview {
  return {
    id,
    type: "movie",
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    background: `https://images.test/${id}-backdrop.jpg`,
    releaseInfo: "2026",
    imdbRating: "8.1",
    genres: ["Drama"],
    description: `${name} is screening tonight.`,
  };
}

const FOUR = [meta("tt1", "One"), meta("tt2", "Two"), meta("tt3", "Three"), meta("tt4", "Four")];

/** The row the Session's store holds after a first page. */
function homeRow(metas: MetaPreview[]): Row {
  return {
    addon: "cinemeta",
    type: "movie",
    id: "top",
    name: "Popular",
    metas,
    offset: metas.length,
    failure: null,
    done: false,
  };
}

/** A Catalog's name as its Addon declared it, which is what a row's head prints. */
const NAMES: Record<string, string> = { top: "Popular", new: "New", other: "Other" };

function catalogRow(
  id: string,
  metas: MetaPreview[],
  sent = metas.length,
  failure: CatalogRow["failure"] = null,
): CatalogRow {
  return { addon: "cinemeta", type: "movie", id, name: NAMES[id] ?? id, sent, metas, failure };
}

function answer(rows: CatalogRow[]): Response {
  return { snapshots: [], answer: { catalogs: rows } };
}

/** The default Host: every Catalog answers its own first page of four. */
function firstPages(action: Action): Response | ActionError {
  if (action.type !== "browse_catalog") {
    return { snapshots: [], answer: null };
  }
  const id = action.catalog.id;
  const skip = action.extra.find((extra) => extra.name === "skip")?.value;
  if (id === "top") {
    if (skip === "4") {
      return answer([catalogRow("top", [meta("tt5", "Five")], 1)]);
    }
    if (skip === "5") {
      return answer([catalogRow("top", [], 0)]);
    }
    return answer([catalogRow("top", FOUR, 4)]);
  }
  return answer([catalogRow(id, [meta(`${id}-1`, "One")], 1)]);
}

/**
 * The Host's one door, with the Actions it was sent kept in order.
 *
 * `dispatch` records before it answers, so a test reads the boundary even while
 * the store's queue is still four wide. An answer that is an `ActionError` is
 * delivered as a rejection, which is what a link does for a refusal.
 */
class FakeHost implements HostLink {
  readonly actions: Action[] = [];
  private held: Snapshot;
  private readonly snapshotHandlers = new Set<(snapshot: Snapshot) => void>();
  private readonly stateHandlers = new Set<(state: LinkState) => void>();

  constructor(
    snapshot: Snapshot,
    private readonly respond: (action: Action) => Response | ActionError,
  ) {
    this.held = snapshot;
  }

  snapshot(): Promise<Snapshot> {
    return Promise.resolve(this.held);
  }

  async dispatch(action: Action): Promise<Response> {
    this.actions.push(action);
    const outcome = this.respond(action);
    if ("kind" in outcome) {
      throw outcome;
    }
    return outcome;
  }

  onSnapshot(handler: (snapshot: Snapshot) => void): () => void {
    this.snapshotHandlers.add(handler);
    return () => {
      this.snapshotHandlers.delete(handler);
    };
  }

  state(): LinkState {
    return { kind: "ready", device: null };
  }

  onState(handler: (state: LinkState) => void): () => void {
    this.stateHandlers.add(handler);
    return () => {
      this.stateHandlers.delete(handler);
    };
  }

  close(): void {
    this.snapshotHandlers.clear();
    this.stateHandlers.clear();
  }

  /** Publish one more Snapshot, as the Host does after a change. */
  publish(next: Snapshot): void {
    this.held = next;
    for (const handler of [...this.snapshotHandlers]) {
      handler(next);
    }
  }
}

/** The asked-for Actions, in the order the Host read them. */
function asks(host: FakeHost): Extract<Action, { type: "browse_catalog" }>[] {
  return host.actions.filter(
    (action): action is Extract<Action, { type: "browse_catalog" }> =>
      action.type === "browse_catalog",
  );
}

/** The screen as the Remote's room hands it: a Session over the link, and spies. */
function Show({
  link,
  pushes,
  choose,
}: {
  link: HostLink;
  pushes: NewLevel<RemotePayload>[];
  choose: (destination: Destination) => void;
}) {
  const { session, state } = useSession(link);
  return (
    <Home
      session={session}
      state={state}
      push={(level) => {
        pushes.push(level);
        return `level-${pushes.length}`;
      }}
      choose={choose}
    />
  );
}

function mount({
  snapshot = SNAPSHOT,
  respond = firstPages,
}: {
  snapshot?: Snapshot;
  respond?: (action: Action) => Response | ActionError;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const choose = vi.fn();
  const view = render(<Show link={host} pushes={pushes} choose={choose} />);
  return { host, pushes, choose, view };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Home's rows", () => {
  test("the first mount asks for every declared Catalog, the Featured one first", async () => {
    const { host } = mount();

    await waitFor(() => expect(asks(host)).toHaveLength(2));
    expect(asks(host)[0]).toEqual({
      type: "browse_catalog",
      addon: "cinemeta",
      catalog: { type: "movie", id: "top" },
      extra: [],
    });
    expect(asks(host).map((action) => action.catalog.id)).toEqual(["top", "new"]);
  });

  test("a Catalog change keeps the surviving row and asks only for the new one", async () => {
    const { host } = mount();
    await waitFor(() => expect(screen.getByTestId("card-cinemeta-tt1")).toBeInTheDocument());
    const asked = asks(host).length;

    const next: Snapshot = {
      ...SNAPSHOT,
      revision: 2,
      addons: [{ ...CINEMETA, catalogs: [POPULAR, OTHER] }],
    };
    await act(async () => {
      host.publish(next);
      await Promise.resolve();
    });
    await flush();

    expect(
      screen.getByTestId("card-cinemeta-tt1"),
      "the surviving row is still drawn",
    ).toBeInTheDocument();
    expect(asks(host).slice(asked)).toEqual([
      {
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "movie", id: "other" },
        extra: [],
      },
    ]);
  });

  test("a row that answered with nothing draws its head and a quiet line", async () => {
    mount({
      respond: (action) =>
        action.type === "browse_catalog" && action.catalog.id === "top"
          ? answer([catalogRow("top", [], 0)])
          : firstPages(action),
    });

    const row = await screen.findByTestId("remote-row-cinemeta/movie/top");
    expect(row).toBeInTheDocument();
    expect(screen.queryByTestId("card-cinemeta-tt1")).not.toBeInTheDocument();
    expect(within(row).getByRole("status")).toBeInTheDocument();
  });

  test("a Catalog that declares no skip still opens its whole row, with no page to ask", async () => {
    const snapshot: Snapshot = {
      ...SNAPSHOT,
      addons: [{ ...CINEMETA, catalogs: [{ ...POPULAR, extra: [] }] }],
    };
    const { pushes } = mount({ snapshot });

    await waitFor(() => expect(screen.getByTestId("card-cinemeta-tt1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "More Popular" }));

    expect(pushes).toEqual([
      gridLevel({
        title: "Popular",
        index: "01",
        tag: rowTag(snapshot, homeRow(FOUR)),
        addon: "cinemeta",
        source: { kind: "home", rowKey: "cinemeta/movie/top" },
      }),
    ]);
  });

  test("a row the Host could not fetch draws the core's explanation in place of its cards", async () => {
    const failure = { kind: "fetch", detail: "timeout" } as const;
    mount({
      respond: (action) =>
        action.type === "browse_catalog" && action.catalog.id === "top"
          ? failure
          : firstPages(action),
    });

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(explain({ kind: "fetch", detail: "timeout" }));
    expect(screen.queryByTestId("card-cinemeta-tt1")).not.toBeInTheDocument();
  });
});

describe("Home's feature", () => {
  test("advances on the core's 24 second beat and starts the programme over at its end", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    mount();

    const feature = await screen.findByTestId("remote-feature");
    expect(feature.getAttribute("data-active-slide")).toBe("tt1");

    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(screen.getByTestId("remote-feature").getAttribute("data-active-slide")).toBe("tt2");

    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS * 3));
    expect(
      screen.getByTestId("remote-feature").getAttribute("data-active-slide"),
      "the beat wraps where a Left/Right press would stop",
    ).toBe("tt1");
  });
});

describe("Home's presses", () => {
  test("a poster card pushes the Title level its row names, and nothing else", async () => {
    const { pushes, host } = mount();
    await waitFor(() => expect(screen.getByTestId("card-cinemeta-tt1")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("card-cinemeta-tt1"));

    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }),
    ]);
    expect(
      host.actions.some((action) => action.type !== "browse_catalog"),
      "B2 asks the Host for nothing but Catalog rows",
    ).toBe(false);
  });

  test("a Continue watching card pushes the Title, and an entry with no Addon does not", async () => {
    const entry: ResumeEntry = {
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
    const gone = {
      ...entry,
      video: { ...entry.video, id: "tt2:1:1" },
      title: { ...entry.title, id: "tt2", name: "Two" },
      unplayable: { reason: "addon_removed", addon: "cinemeta" } as const,
    };
    const { pushes } = mount({
      snapshot: { ...SNAPSHOT, watchProgress: [entry, gone] },
    });

    const pressable = await screen.findByTestId("resume-tt1:1:1");
    fireEvent.click(pressable);
    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
    ]);

    expect(screen.getByTestId("resume-tt2:1:1")).toBeDisabled();
  });

  test("More opens the row as a whole-row grid and asks no page itself", async () => {
    const { host, pushes } = mount();
    await waitFor(() => expect(screen.getByTestId("card-cinemeta-tt4")).toBeInTheDocument());
    const asked = asks(host).length;

    fireEvent.click(screen.getByRole("button", { name: "More Popular" }));

    expect(pushes).toEqual([
      gridLevel({
        title: "Popular",
        index: "01",
        tag: rowTag(SNAPSHOT, homeRow(FOUR)),
        addon: "cinemeta",
        source: { kind: "home", rowKey: "cinemeta/movie/top" },
      }),
    ]);
    expect(
      asks(host),
      "the grid asks the row's next page from its own head, not on opening",
    ).toHaveLength(asked);
  });

  test("the Continue watching rail's More card opens its whole row", async () => {
    const entry: ResumeEntry = {
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
    const { pushes } = mount({
      snapshot: { ...SNAPSHOT, watchProgress: [entry] },
    });
    await waitFor(() => expect(screen.getByTestId("resume-tt1:1:1")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "More Continue watching" }));

    expect(pushes).toEqual([
      gridLevel({
        title: "Continue watching",
        index: "01",
        tag: "1 in progress",
        addon: null,
        source: { kind: "home", rowKey: null },
      }),
    ]);
  });

  test("the empty programme offers the one way out the core names", async () => {
    const { choose } = mount({
      snapshot: { ...SNAPSHOT, addons: [], featuredCatalog: null },
    });

    await screen.findByTestId("remote-empty");
    fireEvent.click(screen.getByRole("button", { name: "Open Addons" }));

    expect(choose).toHaveBeenCalledWith("addons");
  });
});

/**
 * A Home over a Session the test holds: the store outlives the screen, so a
 * remount is a return to the destination and not a fresh visit.
 */
function Attached({
  session,
  pushes,
}: {
  session: Session;
  pushes: NewLevel<RemotePayload>[];
}) {
  useEffect(() => session.start(), [session]);
  const state = useSyncExternalStore(session.subscribe, session.getState);
  return (
    <Home
      session={session}
      state={state}
      push={(level) => {
        pushes.push(level);
        return `level-${pushes.length}`;
      }}
      choose={() => {}}
    />
  );
}

describe("Home's return", () => {
  test("leaving the destination and coming back keeps the rows and asks nothing again", async () => {
    const host = new FakeHost(SNAPSHOT, firstPages);
    const session = new Session(host);
    const pushes: NewLevel<RemotePayload>[] = [];

    const first = render(<Attached session={session} pushes={pushes} />);
    await waitFor(() => expect(screen.getByTestId("card-cinemeta-tt1")).toBeInTheDocument());
    const asked = asks(host).length;
    first.unmount();

    render(<Attached session={session} pushes={pushes} />);

    expect(
      await screen.findByTestId("card-cinemeta-tt1"),
      "the row was kept by the Session's store",
    ).toBeInTheDocument();
    await flush();
    expect(asks(host)).toHaveLength(asked);
  });
});
