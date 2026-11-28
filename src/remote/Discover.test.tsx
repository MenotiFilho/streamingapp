import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import { explain, type ActionError } from "../core/errors";
import type { HostLink } from "../core/link";
import { discoverNoKeyCopy } from "../core/marqueeDiscover";
import type { NewLevel } from "../core/navigation";
import { useSession } from "../core/react/useSession";
import type {
  Action,
  AddonManifest,
  DiscoverRow,
  MetaPreview,
  Response,
  Snapshot,
} from "../core/wire";
import { Discover } from "./Discover";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { titleLevel, type RemotePayload } from "./levels";

let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
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

function tmdbMeta(id: string, name: string, type: "movie" | "series" = "movie"): MetaPreview {
  return {
    id,
    type,
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    releaseInfo: "2023",
    imdbRating: "7.8",
    genres: ["Drama"],
    description: `${name} description`,
  };
}

function discoverResponse(metas: MetaPreview[], sent = metas.length): Response {
  const row: DiscoverRow = {
    type: metas[0]?.type ?? "movie",
    sent,
    metas,
    failure: null,
  };
  return {
    snapshots: [],
    answer: {
      discover: [row],
    },
  };
}

function Show({
  link,
  pushes,
  openSettings,
}: {
  link: HostLink;
  pushes: NewLevel<RemotePayload>[];
  openSettings: () => void;
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
      openSettings={openSettings}
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
  snapshot = WITH_KEY,
  respond = () => discoverResponse([tmdbMeta("tmdb:m1", "Dune")]),
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const openSettings = vi.fn();
  const view = render(
    <Show link={doorOf(host)} pushes={pushes} openSettings={openSettings} />,
  );
  return { host, pushes, openSettings, view };
}

describe("Discover without TMDB Credential", () => {
  test("draws empty state with Open Settings CTA and asks nothing", async () => {
    const { host, openSettings } = mount({ snapshot: WITHOUT_KEY });
    const copy = discoverNoKeyCopy();

    const empty = await screen.findByTestId("discover-no-key");
    expect(empty).toHaveTextContent(copy.title);
    fireEvent.click(within(empty).getByRole("button", { name: "Open Settings" }));
    expect(openSettings).toHaveBeenCalledOnce();
    expect(host.asked("discover")).toEqual([]);
  });
});

describe("Discover over TMDB", () => {
  test("first mount asks Movies by default and opens Discovered Title without Addon on tap", async () => {
    const { host, pushes } = mount();

    const card = await screen.findByTestId("discover-card-tmdb:m1");
    expect(host.asked("discover")).toEqual([
      {
        type: "discover",
        kind: "movie",
        page: 1,
        sort: "popularity.desc",
      },
    ]);

    fireEvent.click(card);
    expect(pushes).toEqual([
      titleLevel({ addon: null, id: "tmdb:m1", type: "movie", name: "Dune" }),
    ]);
  });

  test("switching Type dropdown to Series and selecting a Genre updates the discover request", async () => {
    const { host } = mount({
      respond: (action: Action) => {
        if (action.type !== "discover") {
          return { snapshots: [], answer: null };
        }
        return action.kind === "series"
          ? discoverResponse([tmdbMeta("tmdb:s1", "Severance", "series")])
          : discoverResponse([tmdbMeta("tmdb:m1", "Dune")]);
      },
    });

    await screen.findByTestId("discover-card-tmdb:m1");

    const filters = screen.getByTestId("discover-filters");
    fireEvent.click(within(filters).getByRole("button", { name: /Type/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Series" }));

    expect(await screen.findByTestId("discover-card-tmdb:s1")).toBeInTheDocument();

    fireEvent.click(within(filters).getByRole("button", { name: /Genre/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Drama" }));

    await waitFor(() =>
      expect(
        host.asked("discover").some(
          (a) => a.type === "discover" && a.kind === "series" && a.genre === 18,
        ),
      ).toBe(true),
    );
  });

  test("marks cards unplayable when no configured Addon can answer their kind (ADR-0020)", async () => {
    mount({
      snapshot: { ...WITH_KEY, addons: [] },
    });

    const card = await screen.findByTestId("discover-card-tmdb:m1");
    expect(card.closest("[data-unplayable]")).toHaveAttribute("data-unplayable", "true");
  });

  test("draws PhoneAddonNotice on failure and retries cleanly", async () => {
    const failure: ActionError = { kind: "tmdb", detail: "TMDB rate limited" };
    let attempt = 0;
    const { host } = mount({
      respond: () => {
        attempt += 1;
        return attempt === 1
          ? {
              snapshots: [],
              answer: {
                discover: [{ type: "movie", sent: 0, metas: [], failure }],
              },
            }
          : discoverResponse([tmdbMeta("tmdb:m2", "Arrival")]);
      },
    });

    const notice = await screen.findByTestId("discover-failure");
    expect(notice).toHaveTextContent(explain(failure));

    fireEvent.click(within(notice).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("discover-card-tmdb:m2")).toBeInTheDocument();
    expect(host.asked("discover")).toHaveLength(2);
  });
});
