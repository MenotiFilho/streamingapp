import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

import type { Destination } from "../core/destinations";
import { explain } from "../core/errors";
import { marqueeHomeEmptyState, wideCardNote } from "../core/homeHero";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useSession } from "../core/react/useSession";
import type {
  Action,
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  ContinueEntry,
  MetaPreview,
  Response,
  Snapshot,
} from "../core/wire";
import { Home } from "./Home";
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

const TOP: AddonCatalog = { type: "movie", id: "top", name: "Popular", extra: [] };

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [TOP],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
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
    background: `https://images.test/${id}-bg.jpg`,
    posterShape: "poster",
    releaseInfo: "2024",
    imdbRating: "8.1",
    genres: ["Drama", "Thriller"],
    description: `${name} overview`,
  };
}

function rowOf(metas: MetaPreview[], sent = metas.length): CatalogRow {
  return {
    addon: "cinemeta",
    type: "movie",
    id: "top",
    name: "Popular",
    sent,
    metas,
    failure: null,
  };
}

function ok(rows: CatalogRow[]): Response {
  return { snapshots: [], answer: { catalogs: rows } };
}

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
  snapshot = SNAPSHOT,
  respond = () => ok([rowOf([meta("tt1", "One"), meta("tt2", "Two")])]),
}: {
  snapshot?: Snapshot;
  respond?: Respond;
} = {}) {
  const host = new FakeHost(snapshot, respond);
  const pushes: NewLevel<RemotePayload>[] = [];
  const choose = vi.fn();
  const view = render(<Show link={doorOf(host)} pushes={pushes} choose={choose} />);
  return { host, pushes, choose, view };
}

describe("Home at hand scale", () => {
  test("first mount syncs declared Catalogs once, renders Featured PhoneHero and Catalog rail", async () => {
    const { host, pushes } = mount();

    const hero = await screen.findByTestId("remote-home-hero");
    expect(within(hero).getByText("One")).toBeInTheDocument();
    expect(within(hero).getByText("IMDb 8.1 · 2024 · Drama · Thriller")).toBeInTheDocument();

    const card = await screen.findByTestId("card-cinemeta-tt1");
    fireEvent.click(card);
    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }),
    ]);

    expect(host.asked("browse_catalog")).toHaveLength(1);
  });

  test("Watch now on Featured Hero resumes when Title has a resumable entry, otherwise opens Title", async () => {
    const { pushes } = mount();
    const hero = await screen.findByTestId("remote-home-hero");
    fireEvent.click(within(hero).getByRole("button", { name: "Watch now" }));
    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }),
    ]);

    cleanup();

    const resumableSnapshot: Snapshot = {
      ...SNAPSHOT,
      continueWatching: [
        {
          video: { id: "tt1", name: null, season: null, episode: null, thumbnail: null, airDate: null },
          title: {
            addon: "cinemeta",
            id: "tt1",
            type: "movie",
            name: "One",
            poster: null,
            background: null,
          },
          position: 120,
          duration: 600,
          watched: false,
          upNext: false,
          unplayable: null,
        },
      ],
    };
    const resumed = mount({ snapshot: resumableSnapshot });
    const hero2 = await screen.findByTestId("remote-home-hero");
    fireEvent.click(within(hero2).getByRole("button", { name: "Watch now" }));
    await waitFor(() =>
      expect(resumed.host.asked("resume")).toEqual([
        { type: "resume", video: { type: "movie", id: "tt1" } },
      ]),
    );
  });

  test("swiping Featured Hero sideways advances to the next slide", async () => {
    mount({
      respond: () => ok([rowOf([meta("tt1", "One"), meta("tt2", "Two")])]),
    });

    const hero = await screen.findByTestId("remote-home-hero");
    const region = within(hero).getByRole("region", { name: "Featured" });
    expect(within(region).getByText("One")).toBeInTheDocument();

    fireEvent.pointerDown(region, { pointerId: 1, clientX: 250, clientY: 200 });
    fireEvent.pointerUp(region, { pointerId: 1, clientX: 120, clientY: 205 });

    await waitFor(() => expect(within(region).getByText("Two")).toBeInTheDocument());
  });

  test("Continue watching renders playable entries and disables addon_disabled/addon_removed entries with ADR-0044 reason", async () => {
    const playable: ContinueEntry = {
      video: { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
      title: {
        addon: "cinemeta",
        id: "tt1",
        type: "series",
        name: "One",
        poster: null,
        background: null,
        logo: "https://images.test/one-logo.png",
      },
      position: 300,
      duration: 600,
      watched: false,
      upNext: true,
      unplayable: null,
    };
    const disabledEntry: ContinueEntry = {
      ...playable,
      video: { ...playable.video, id: "tt2:1:1" },
      title: { ...playable.title, id: "tt2", name: "Two" },
      unplayable: { reason: "addon_disabled", addon: "cinemeta" },
    };
    const { pushes } = mount({
      snapshot: { ...SNAPSHOT, continueWatching: [playable, disabledEntry] },
    });

    const row = await screen.findByTestId("remote-continue");
    expect(within(row).getByText(wideCardNote(disabledEntry))).toBeInTheDocument();
    expect(screen.getByTestId("resume-tt2:1:1")).toBeDisabled();

    fireEvent.click(screen.getByTestId("resume-tt1:1:1"));
    expect(pushes).toEqual([
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
    ]);
  });

  test("failed Catalog row draws PhoneAddonNotice and retries through session.home.page", async () => {
    const failure = { kind: "fetch", detail: "timed out" } as const;
    let attempt = 0;
    const { host } = mount({
      respond: (action: Action) => {
        if (action.type !== "browse_catalog") {
          return { snapshots: [], answer: null };
        }
        attempt += 1;
        return attempt === 1
          ? ok([{ ...rowOf([]), failure }])
          : ok([rowOf([meta("tt9", "Recovered")])]);
      },
    });

    const row = await screen.findByTestId("remote-row-cinemeta/movie/top");
    expect(within(row).getByRole("status")).toHaveTextContent(explain(failure));

    fireEvent.click(within(row).getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("card-cinemeta-tt9")).toBeInTheDocument();
    expect(host.asked("browse_catalog")).toHaveLength(2);
  });

  test("no declared Catalogs draws empty state and Open Addons jumps to addons", async () => {
    const noCatalogs = { ...NOTHING, addons: [] };
    const { choose } = mount({ snapshot: noCatalogs });
    const expected = marqueeHomeEmptyState(noCatalogs, 0)!;

    const empty = await screen.findByTestId("remote-empty");
    expect(empty).toHaveTextContent(expected.title);
    fireEvent.click(within(empty).getByRole("button", { name: "Open Addons" }));
    expect(choose).toHaveBeenCalledWith("addons");
  });
});
