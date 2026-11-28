import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { explain, type ActionError } from "../core/errors";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useSession } from "../core/react/useSession";
import { searchNoCatalogsNote, searchPromptCopy } from "../core/marqueeSearch";
import { searchFeedKey } from "../core/search";
import type { Session } from "../core/session";
import type {
  Action,
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  MetaPreview,
  Response,
  Snapshot,
} from "../core/wire";
import { FakeHost, type HostAnswer, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { titleLevel, type RemotePayload } from "./levels";
import { Search } from "./Search";

const SEARCHABLE: AddonCatalog = {
  type: "movie",
  id: "top",
  name: "Popular",
  extra: [{ name: "search", isRequired: true, options: [], optionsLimit: 0 }],
};

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [
    { name: "catalog", types: ["movie", "series"], idPrefixes: ["tt"] },
    { name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] },
  ],
  types: ["movie", "series"],
  catalogs: [SEARCHABLE],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const WITH_KEY: Snapshot = {
  ...NOTHING,
  addons: [CINEMETA],
  protection: { backend: "file", tmdbHeld: true, stremioHeld: false },
};

const WITHOUT_KEY: Snapshot = {
  ...WITH_KEY,
  protection: { ...WITH_KEY.protection, tmdbHeld: false },
};

function hit(id: string, name: string, type: string = "movie"): MetaPreview {
  return {
    id,
    type,
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    releaseInfo: "1999",
    imdbRating: "8.7",
    genres: ["Sci-Fi"],
    description: `${name} hit`,
  };
}

function catalogRow(metas: MetaPreview[]): CatalogRow {
  return {
    addon: "cinemeta",
    type: "movie",
    id: "top",
    name: "Popular",
    sent: metas.length,
    metas,
    failure: null,
  };
}

function Show({
  link,
  pushes,
  onSession,
}: {
  link: HostLink;
  pushes: NewLevel<RemotePayload>[];
  onSession?: (session: Session) => void;
}) {
  const { session, state } = useSession(link);
  useEffect(() => {
    onSession?.(session);
  }, [onSession, session]);
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

function Room({
  link,
  pushes,
}: {
  link: HostLink;
  pushes: NewLevel<RemotePayload>[];
}) {
  const { session, state } = useSession(link);
  const [away, setAway] = useState(false);
  if (away) {
    return (
      <button type="button" onClick={() => setAway(false)}>
        Back from Title
      </button>
    );
  }
  return (
    <Search
      session={session}
      state={state}
      push={(level) => {
        pushes.push(level);
        setAway(true);
        return `level-${pushes.length}`;
      }}
    />
  );
}

function doorOf(host: FakeHost): HostLink {
  const state = host.state();
  return {
    snapshot: () => host.snapshot(),
    dispatch: (action) => host.dispatch(action),
    onSnapshot: (handler) => host.onSnapshot(handler),
    onRevision: (handler) => host.onRevision(handler),
    state: () => state,
    onState: (handler) => host.onState(handler),
    close: () => host.close(),
  };
}

function mount({
  snapshot = WITHOUT_KEY,
  respond = () => ({ snapshots: [], answer: { catalogs: [] } }),
  onSession,
}: {
  snapshot?: Snapshot;
  respond?: Respond;
  onSession?: (session: Session) => void;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const view = render(<Show link={doorOf(host)} pushes={pushes} onSession={onSession} />);
  return { host, pushes, view };
}

async function submitQuery(value: string) {
  const form = await screen.findByRole("search");
  const input = within(form).getByRole("searchbox");
  fireEvent.change(input, { target: { value } });
  fireEvent.submit(form);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("Search on Remote", () => {
  test("before submit draws the prompt and an empty submit sends nothing", async () => {
    const { host } = mount({ snapshot: WITH_KEY });
    const prompt = await screen.findByTestId("search-prompt");
    expect(prompt).toHaveTextContent(searchPromptCopy(true).title);

    await submitQuery("   ");
    await flush();
    expect(host.actions).toEqual([]);
  });

  test("without TMDB key, submits search_catalogs and opens Addon card Title", async () => {
    const { host, pushes } = mount({
      snapshot: WITHOUT_KEY,
      respond: (action: Action): Response =>
        action.type === "search_catalogs"
          ? { snapshots: [], answer: { catalogs: [catalogRow([hit("tt1", "Matrix")])] } }
          : { snapshots: [], answer: null },
    });

    await submitQuery("Matrix");
    const card = await screen.findByTestId("search-card-cinemeta-tt1");
    expect(host.asked("search_catalogs")).toEqual([
      { type: "search_catalogs", query: "Matrix" },
    ]);
    expect(host.asked("search")).toEqual([]);

    fireEvent.click(card);
    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "Matrix" }),
    ]);
  });

  test("with TMDB key, queries search_catalogs plus TMDB Movies and Series rows with Read on", async () => {
    const { host, pushes } = mount({
      snapshot: WITH_KEY,
      respond: (action: Action): Response => {
        if (action.type === "search_catalogs") {
          return { snapshots: [], answer: { catalogs: [catalogRow([hit("tt1", "Matrix")])] } };
        }
        if (action.type === "search") {
          const isSeries = action.kind === "series";
          if (action.page === 2 && !isSeries) {
            return {
              snapshots: [],
              answer: {
                search: {
                  type: "movie",
                  sent: 1,
                  metas: [hit("tmdb:2", "Matrix Reloaded", "movie")],
                  failure: null,
                },
              },
            };
          }
          return {
            snapshots: [],
            answer: {
              search: {
                type: action.kind,
                sent: 1,
                metas: [
                  isSeries
                    ? hit("tmdb:s1", "Matrix Series", "series")
                    : hit("tmdb:1", "The Matrix", "movie"),
                ],
                failure: null,
              },
            },
          };
        }
        return { snapshots: [], answer: null };
      },
    });

    await submitQuery("Matrix");

    expect(await screen.findByTestId("search-card-cinemeta-tt1")).toBeInTheDocument();
    const movieCard = await screen.findByTestId("search-card-movie-tmdb:1");
    expect(await screen.findByTestId("search-card-series-tmdb:s1")).toBeInTheDocument();

    fireEvent.click(movieCard);
    expect(pushes).toEqual([
      titleLevel({ addon: null, id: "tmdb:1", type: "movie", name: "The Matrix" }),
    ]);

    const moviesRow = screen.getByTestId("remote-search-row-movie");
    fireEvent.click(within(moviesRow).getByRole("button", { name: "Read on" }));
    expect(await screen.findByTestId("search-card-movie-tmdb:2")).toBeInTheDocument();
    expect(host.asked("search")).toHaveLength(3);
  });

  test("draws PhoneAddonNotice on catalog failure and retries cleanly on Try again", async () => {
    const failure: ActionError = { kind: "catalog", detail: "search unavailable" };
    let attempt = 0;
    const { host } = mount({
      snapshot: WITHOUT_KEY,
      respond: (action: Action): HostAnswer => {
        if (action.type !== "search_catalogs") {
          return { snapshots: [], answer: null };
        }
        attempt += 1;
        return attempt === 1
          ? failure
          : { snapshots: [], answer: { catalogs: [catalogRow([hit("tt1", "Matrix")])] } };
      },
    });

    await submitQuery("Matrix");
    const notice = await screen.findByTestId("search-catalogs-failure");
    expect(notice).toHaveTextContent(explain(failure));

    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("search-card-cinemeta-tt1")).toBeInTheDocument();
    expect(host.asked("search_catalogs")).toHaveLength(2);
  });

  test("cancels a stale query answer when a newer query was submitted", async () => {
    const held: Array<() => void> = [];
    const { host } = mount({
      snapshot: WITH_KEY,
      respond: (action: Action) =>
        new Promise<HostAnswer>((resolve) => {
          held.push(() => {
            if (action.type === "search_catalogs") {
              resolve({ snapshots: [], answer: { catalogs: [] } });
              return;
            }
            if (action.type === "search") {
              resolve({
                snapshots: [],
                answer: {
                  search: {
                    type: action.kind,
                    sent: 1,
                    metas: [hit(`${action.query}-${action.kind}`, action.query, action.kind)],
                    failure: null,
                  },
                },
              });
              return;
            }
            resolve({ snapshots: [], answer: null });
          });
        }),
    });

    await submitQuery("dune");
    await waitFor(() => expect(held).toHaveLength(3));

    await submitQuery("matrix");
    await waitFor(() => expect(held).toHaveLength(6));

    // Resolve newer query ("matrix") first, then stale query ("dune").
    act(() => {
      held[3]?.();
      held[4]?.();
      held[5]?.();
    });
    expect(await screen.findByTestId("search-card-movie-matrix-movie")).toBeInTheDocument();

    act(() => {
      held[0]?.();
      held[1]?.();
      held[2]?.();
    });
    await flush();

    expect(host.asked("search").map((a) => a.query)).toEqual([
      "dune",
      "dune",
      "matrix",
      "matrix",
    ]);
    expect(screen.getByTestId("search-card-movie-matrix-movie")).toBeInTheDocument();
    expect(screen.queryByTestId("search-card-movie-dune-movie")).not.toBeInTheDocument();
  });

  test("toggling TMDB credential clears the search without querying the new arm, and submitting runs it again", async () => {
    const { host } = mount({
      snapshot: WITH_KEY,
      respond: (action: Action): Response => {
        if (action.type === "search") {
          return {
            snapshots: [],
            answer: {
              search: {
                type: action.kind,
                sent: 1,
                metas: [hit(`tmdb:${action.kind}`, "Matrix", action.kind)],
                failure: null,
              },
            },
          };
        }
        if (action.type === "search_catalogs") {
          return {
            snapshots: [],
            answer: { catalogs: [catalogRow([hit("tt1", "Matrix")])] },
          };
        }
        return { snapshots: [], answer: null };
      },
    });

    await submitQuery("Matrix");
    expect(await screen.findByTestId("search-card-movie-tmdb:movie")).toBeInTheDocument();
    const catalogAsksBefore = host.asked("search_catalogs").length;

    act(() => {
      host.publish(WITHOUT_KEY);
    });

    expect(await screen.findByTestId("search-prompt")).toBeInTheDocument();
    expect(screen.queryByTestId("search-card-movie-tmdb:movie")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Search for a Title")).toHaveValue("");
    expect(host.asked("search_catalogs")).toHaveLength(catalogAsksBefore);

    await submitQuery("Arrival");
    expect(await screen.findByTestId("search-card-cinemeta-tt1")).toBeInTheDocument();
    expect(host.asked("search_catalogs")).toHaveLength(catalogAsksBefore + 1);
  });

  test("draws the no-searchable-catalogs note when no catalog can be searched", async () => {
    mount({
      snapshot: WITHOUT_KEY,
      respond: () => ({ snapshots: [], answer: { catalogs: [] } }),
    });

    await submitQuery("Matrix");
    expect(await screen.findByTestId("search-no-answer")).toHaveTextContent(
      searchNoCatalogsNote(false)!,
    );
  });

  test("Back from a Title keeps the keyed query, the draft and the loaded pages, and does not ask page 1 again", async () => {
    const host = new FakeHost(WITH_KEY, (action: Action): Response => {
      if (action.type === "search_catalogs") {
        return { snapshots: [], answer: { catalogs: [catalogRow([hit("tt1", "Matrix")])] } };
      }
      if (action.type === "search") {
        if (action.kind === "movie" && action.page === 2) {
          return {
            snapshots: [],
            answer: {
              search: {
                type: "movie",
                sent: 1,
                metas: [hit("tmdb:2", "Matrix Reloaded", "movie")],
                failure: null,
              },
            },
          };
        }
        return {
          snapshots: [],
          answer: {
            search: {
              type: action.kind,
              sent: 1,
              metas: [
                action.kind === "series"
                  ? hit("tmdb:s1", "Matrix Series", "series")
                  : hit("tmdb:1", "The Matrix", "movie"),
              ],
              failure: null,
            },
          },
        };
      }
      return { snapshots: [], answer: null };
    });
    const pushes: NewLevel<RemotePayload>[] = [];
    const view = render(<Room link={doorOf(host)} pushes={pushes} />);
    try {
      await submitQuery("Matrix");
      await screen.findByTestId("search-card-movie-tmdb:1");

      const moviesRow = screen.getByTestId("remote-search-row-movie");
      fireEvent.click(within(moviesRow).getByRole("button", { name: "Read on" }));
      await screen.findByTestId("search-card-movie-tmdb:2");

      const moviePage1Asks = host
        .asked("search")
        .filter((action) => action.kind === "movie" && action.page === 1).length;
      const seriesPage1Asks = host
        .asked("search")
        .filter((action) => action.kind === "series" && action.page === 1).length;
      const catalogAsks = host.asked("search_catalogs").length;

      fireEvent.change(screen.getByLabelText("Search for a Title"), {
        target: { value: "Matrix draft" },
      });

      fireEvent.click(screen.getByTestId("search-card-movie-tmdb:2"));
      expect(await screen.findByRole("button", { name: "Back from Title" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back from Title" }));

      expect(await screen.findByLabelText("Search for a Title")).toHaveValue("Matrix draft");
      expect(await screen.findByTestId("search-card-movie-tmdb:2")).toBeInTheDocument();
      expect(screen.getByTestId("search-card-movie-tmdb:1")).toBeInTheDocument();
      expect(screen.getByTestId("search-card-series-tmdb:s1")).toBeInTheDocument();
      expect(screen.getByTestId("search-card-cinemeta-tt1")).toBeInTheDocument();
      expect(
        host.asked("search").filter((action) => action.kind === "movie" && action.page === 1),
      ).toHaveLength(moviePage1Asks);
      expect(
        host.asked("search").filter((action) => action.kind === "series" && action.page === 1),
      ).toHaveLength(seriesPage1Asks);
      expect(host.asked("search_catalogs")).toHaveLength(catalogAsks);
    } finally {
      view.unmount();
    }
  });

  test("Back from a Title keeps the keyless query and the Catalog rows, and does not ask search_catalogs again", async () => {
    const host = new FakeHost(WITHOUT_KEY, (action: Action): Response =>
      action.type === "search_catalogs"
        ? { snapshots: [], answer: { catalogs: [catalogRow([hit("tt1", "Matrix")])] } }
        : { snapshots: [], answer: null },
    );
    const pushes: NewLevel<RemotePayload>[] = [];
    const view = render(<Room link={doorOf(host)} pushes={pushes} />);
    try {
      await submitQuery("Matrix");
      await screen.findByTestId("search-card-cinemeta-tt1");

      fireEvent.click(screen.getByTestId("search-card-cinemeta-tt1"));
      expect(await screen.findByRole("button", { name: "Back from Title" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Back from Title" }));

      expect(await screen.findByLabelText("Search for a Title")).toHaveValue("Matrix");
      expect(await screen.findByTestId("search-card-cinemeta-tt1")).toBeInTheDocument();
      expect(host.asked("search_catalogs")).toHaveLength(1);
    } finally {
      view.unmount();
    }
  });

  test("a failed TMDB search row draws PhoneAddonNotice with the Host's explanation and retries via session.feeds.more while leaving the other kind intact", async () => {
    const failure: ActionError = { kind: "tmdb", detail: "TMDB answered with status 429" };
    let movieAttempt = 0;
    let sessionRef: Session | null = null;
    const { host } = mount({
      snapshot: WITH_KEY,
      onSession: (session) => {
        sessionRef = session;
      },
      respond: (action: Action): HostAnswer => {
        if (action.type === "search_catalogs") {
          return { snapshots: [], answer: { catalogs: [] } };
        }
        if (action.type === "search") {
          if (action.kind === "movie") {
            movieAttempt += 1;
            if (movieAttempt === 1) {
              return failure;
            }
          }
          return {
            snapshots: [],
            answer: {
              search: {
                type: action.kind,
                sent: 1,
                metas: [
                  action.kind === "series"
                    ? hit("tmdb:s1", "Matrix Series", "series")
                    : hit("tmdb:1", "The Matrix", "movie"),
                ],
                failure: null,
              },
            },
          };
        }
        return { snapshots: [], answer: null };
      },
    });

    await waitFor(() => expect(sessionRef).not.toBeNull());
    const moreSpy = vi.spyOn(sessionRef!.feeds, "more");

    await submitQuery("Matrix");

    const moviesRow = await screen.findByTestId("remote-search-row-movie");
    const notice = await within(moviesRow).findByRole("status");
    expect(notice).toHaveTextContent("TMDB");
    expect(notice).toHaveTextContent(explain(failure));

    const seriesRow = screen.getByTestId("remote-search-row-series");
    expect(await within(seriesRow).findByTestId("search-card-series-tmdb:s1")).toBeInTheDocument();
    expect(within(seriesRow).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();

    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));

    expect(moreSpy).toHaveBeenCalledWith(searchFeedKey("Matrix", "movie"));
    expect(await within(moviesRow).findByTestId("search-card-movie-tmdb:1")).toBeInTheDocument();
    expect(within(moviesRow).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(host.asked("search")).toEqual([
      { type: "search", query: "Matrix", kind: "movie", page: 1 },
      { type: "search", query: "Matrix", kind: "series", page: 1 },
      { type: "search", query: "Matrix", kind: "movie", page: 1 },
    ]);
  });
});
