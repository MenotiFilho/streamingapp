import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { explain, type ActionError } from "../core/errors";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useSession } from "../core/react/useSession";
import { searchPromptCopy } from "../core/marqueeSearch";
import type {
  Action,
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  MetaPreview,
  Response,
  Snapshot,
} from "../core/wire";
import { FakeHost, type Respond } from "./fakeHost.testing";
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

function hit(id: string, name: string, type: "movie" | "series" = "movie"): MetaPreview {
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
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const view = render(<Show link={doorOf(host)} pushes={pushes} />);
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

  test("draws PhoneAddonNotice on catalog failure", async () => {
    const failure: ActionError = { kind: "catalog", detail: "search unavailable" };
    mount({
      snapshot: WITHOUT_KEY,
      respond: () => failure,
    });

    await submitQuery("Matrix");
    const notice = await screen.findByTestId("search-catalogs-failure");
    expect(notice).toHaveTextContent(explain(failure));
    await waitFor(() =>
      expect(within(notice).getByRole("button", { name: "Try again" })).toBeInTheDocument(),
    );
  });
});
