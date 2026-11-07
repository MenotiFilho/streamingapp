import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { StrictMode, useEffect, useSyncExternalStore } from "react";
import { describe, expect, test, vi } from "vitest";

import { explain, type ActionError } from "../core/errors";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useNavigation } from "../core/react/useNavigation";
import { Session } from "../core/session";
import type {
  Action,
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  ContinueEntry,
  MetaPreview,
  Response,
  Snapshot,
  Title,
} from "../core/wire";
import { RemoteApp } from "./RemoteApp";
import { TitleScreen } from "./TitleScreen";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { RemoteLevel, titleLevel, type RemotePayload } from "./levels";
import {
  FIND_STREAMS,
  TITLE_RETRY,
  answeredTitleLevel,
} from "./titleScreen";

/**
 * The Title level over a fake HostLink (#210, ADR-0032, docs/agents/testing.md).
 *
 * The assertions are the level's decisions: the one question a card asks, the
 * answer it re-pushes so a Streams level and a Back do not ask again, the
 * Streams level a film's Play pushes, the Host's words and retry a refusal
 * leaves, and the stack Back unwinds without changing the destination under it.
 * Nothing here reads a class, a nesting or a line of copy the core did not
 * choose.
 */

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };
const POPULAR: AddonCatalog = { type: "movie", id: "top", name: "Popular", extra: [SKIP] };

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [POPULAR],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const SNAPSHOT: Snapshot = { ...NOTHING, addons: [CINEMETA] };

const CARD_META: MetaPreview = {
  id: "tt1",
  type: "movie",
  name: "One",
  poster: "https://images.test/one.jpg",
  posterShape: "poster",
  releaseInfo: "1999",
  imdbRating: "8.7",
  genres: ["Sci-Fi"],
  description: "One is screening tonight.",
};

const ROW: CatalogRow = {
  addon: "cinemeta",
  type: "movie",
  id: "top",
  name: "Popular",
  sent: 1,
  metas: [CARD_META],
  failure: null,
};

const FILM: Title = {
  addon: "cinemeta",
  id: "tt1",
  key: { kind: "addon", addon: "cinemeta", id: "tt1" },
  type: "movie",
  name: "One",
  poster: "https://images.test/one.jpg",
  background: "https://images.test/one-backdrop.jpg",
  logo: null,
  description: "One is screening tonight.",
  releaseInfo: "1999",
  runtime: "136 min",
  imdbRating: "8.7",
  genres: ["Sci-Fi"],
  videos: [],
};

const SERIES: Title = {
  ...FILM,
  type: "series",
  videos: [
    { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
    {
      id: "tt1:1:2",
      name: "Cat's in the Bag...",
      season: 1,
      episode: 2,
      thumbnail: "https://images.test/s1e2.jpg",
      airDate: null,
    },
    { id: "tt1:2:1", name: "Seven Thirty-Seven", season: 2, episode: 1, thumbnail: null, airDate: null },
  ],
};

/** The same series with an announced second episode, which must stay playable. */
const UNAIRED: Title = {
  ...SERIES,
  videos: SERIES.videos.map((video) =>
    video.id === "tt1:1:2" ? { ...video, airDate: "2999-01-02" } : video,
  ),
};

/** The Host the room walks: one card, one Title, and Streams for whatever it is asked. */
function answering(title: Title = FILM): Respond {
  return (action: Action) => {
    switch (action.type) {
      case "browse_catalog":
        return { snapshots: [], answer: { catalogs: [ROW] } };
      case "open_title":
        return { snapshots: [], answer: { title } };
      case "find_streams":
        return { snapshots: [], answer: { streams: [] } };
      default:
        return { snapshots: [], answer: null };
    }
  };
}

/**
 * The Host's door with a state read React can cache.
 *
 * `FakeHost.state` builds a fresh object per call, which `useSyncExternalStore`
 * would read as a change on every render; the door is wrapped rather than the
 * fake being reshaped, because the state this page follows never moves here.
 */
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

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

/** The real room, walked from Home's only card to the answered Title. */
async function openFilm() {
  const host = new FakeHost(SNAPSHOT, answering());
  render(<RemoteApp link={doorOf(host)} />);
  fireEvent.click(await screen.findByTestId("card-cinemeta-tt1"));
  await screen.findByTestId("remote-title-page");
  return host;
}

/**
 * The level stack on its own: one seeded level, the real navigation, and the
 * real `RemoteLevel`. A case that is about the level's own question does not
 * need Home behind it.
 */
function Stack({ session, level }: { session: Session; level: NewLevel<RemotePayload> }) {
  const nav = useNavigation<RemotePayload>();
  const state = useSyncExternalStore(session.subscribe, session.getState);

  useEffect(() => {
    nav.push(level);
  }, []);

  const top = nav.levels[nav.levels.length - 1] ?? null;
  return top ? (
    <RemoteLevel
      level={top}
      session={session}
      state={state}
      push={nav.push}
      pop={nav.pop}
    />
  ) : null;
}

function mountStack(
  respond: Respond,
  level = titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }),
  snapshot: Snapshot = SNAPSHOT,
) {
  const host = new FakeHost(snapshot, respond);
  const session = new Session(host);
  // The room the Remote draws always follows a started Session; the anchor reads
  // the Continue watching list from the Snapshot that start reads.
  session.start();
  const view = render(<Stack session={session} level={level} />);
  return { host, session, view };
}

function continueEntry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: { id: "tt1:1:2", name: null, season: 1, episode: 2, thumbnail: null, airDate: null },
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
    ...overrides,
  };
}

describe("a Continue watching card on the Remote", () => {
  test("opens its Title on the card's season and episode", async () => {
    const host = new FakeHost(
      {
        ...SNAPSHOT,
        continueWatching: [
          continueEntry({
            video: { id: "tt1:2:1", name: null, season: 2, episode: 1, thumbnail: null, airDate: null },
          }),
        ],
      },
      answering(SERIES),
    );
    render(<RemoteApp link={doorOf(host)} />);

    fireEvent.click(await screen.findByTestId("resume-tt1:2:1"));
    await screen.findByTestId("remote-title-page");

    expect(screen.getByRole("button", { name: /Season 2/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("episode-tt1:2:1")).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the Title level's one question", () => {
  test("an Addon's card asks open_title on the first mount, and only once", async () => {
    const host = await openFilm();

    expect(host.asked("open_title")).toEqual([
      {
        type: "open_title",
        addon: "cinemeta",
        title: { type: "movie", id: "tt1" },
      },
    ]);

    // A Snapshot is not a second arrival: the answer is already on the level.
    await act(async () => {
      host.publish({ ...SNAPSHOT, revision: 2 });
      await Promise.resolve();
    });
    await flush();
    expect(host.asked("open_title")).toHaveLength(1);
  });

  test("a Discovered Title asks open_discovered_title with the core's key", async () => {
    const discovered: Title = {
      ...FILM,
      addon: null,
      id: "tmdb:603",
      key: { kind: "tmdb", id: 603 },
      name: "The Matrix",
    };
    const { host } = mountStack(
      () => ({ snapshots: [], answer: { title: discovered } }),
      titleLevel({ addon: null, id: "tmdb:603", type: "movie", name: "The Matrix" }),
    );

    await screen.findByTestId("remote-title-page");

    expect(host.asked("open_discovered_title")).toEqual([
      {
        type: "open_discovered_title",
        key: { kind: "tmdb", id: 603 },
        kind: "movie",
      },
    ]);
    expect(host.asked("open_title")).toEqual([]);
  });
});

describe("the Title level under a strict render", () => {
  test("a StrictMode remount does not ask twice and still takes the answer", async () => {
    const card = { addon: "cinemeta", id: "tt1", type: "movie", name: "One" };
    const host = new FakeHost(SNAPSHOT, () => ({
      snapshots: [],
      answer: { title: FILM },
    }));
    const session = new Session(host);
    const push = vi.fn(() => "level-1");

    render(
      <StrictMode>
        <TitleScreen
          levelId="level-1"
          card={card}
          answer={null}
          session={session}
          state={session.getState()}
          push={push}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(host.asked("open_title")).toHaveLength(1);
    expect(push).toHaveBeenCalledWith(answeredTitleLevel(card, FILM, "level-1"));
  });
});

describe("the answer the level keeps", () => {
  test("a Streams push and a Back find the Title already in the stack", async () => {
    const host = await openFilm();

    fireEvent.click(screen.getByRole("button", { name: FIND_STREAMS }));
    await screen.findByTestId("remote-streams");

    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByTestId("remote-title-page");

    expect(
      host.asked("open_title"),
      "the Title is drawn from the answer the level holds",
    ).toHaveLength(1);
  });

  test("the second Back returns to the destination underneath, unchanged", async () => {
    await openFilm();
    fireEvent.click(screen.getByRole("button", { name: FIND_STREAMS }));
    await screen.findByTestId("remote-streams");

    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByTestId("remote-title-page");
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("remote-title-page")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("card-cinemeta-tt1")).toBeInTheDocument();
  });

  test("leaving while the Host is answering does not bring the Title back", async () => {
    let answer!: (outcome: Response) => void;
    const held = new Promise<Response>((resolve) => {
      answer = resolve;
    });
    const host = new FakeHost(SNAPSHOT, (action) => {
      if (action.type === "browse_catalog") {
        return { snapshots: [], answer: { catalogs: [ROW] } };
      }
      return action.type === "open_title" ? held : { snapshots: [], answer: null };
    });
    render(
      <Stack
        session={new Session(host)}
        level={titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "One" })}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "Back" }));
    await act(async () => {
      answer({ snapshots: [], answer: { title: FILM } });
      await Promise.resolve();
    });
    await flush();

    expect(screen.queryByTestId("remote-title")).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument();
  });
});

describe("a refused or empty answer", () => {
  test("a refusal is the Host's words, with a retry that asks again", async () => {
    const refusal: ActionError = { kind: "fetch", detail: "timeout" };
    let refuse = true;
    const { host } = mountStack(() =>
      refuse
        ? refusal
        : { snapshots: [], answer: { title: FILM } },
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(explain(refusal));

    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: TITLE_RETRY }));

    await screen.findByTestId("remote-title-page");
    expect(host.asked("open_title")).toHaveLength(2);
  });
});

describe("a film's Play", () => {
  test("pushes Streams for the film's Video, which is the film itself", async () => {
    const host = await openFilm();

    fireEvent.click(screen.getByRole("button", { name: FIND_STREAMS }));

    await screen.findByTestId("remote-streams");
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "movie", id: "tt1" } },
    ]);
  });
});

describe("a series' season chips", () => {
  test("follow the Host's order, so the Specials chip is last", async () => {
    const withSpecials: Title = {
      ...SERIES,
      videos: [
        { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
        { id: "tt1:2:1", name: "Seven Thirty-Seven", season: 2, episode: 1, thumbnail: null, airDate: null },
        { id: "tt1:0:1", name: "Special", season: 0, episode: 1, thumbnail: null, airDate: null },
      ],
    };
    mountStack(
      answering(withSpecials),
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
    );
    await screen.findByTestId("remote-title-page");

    expect(
      screen.getAllByTestId(/^season-/).map((chip) => chip.dataset.testid),
    ).toEqual(["season-1", "season-2", "season-0"]);
  });
});

describe("a series' Play", () => {
  test("opens Streams for the chosen episode, starting with the first of the first season", async () => {
    const { host } = mountStack(answering(SERIES), titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }));
    await screen.findByTestId("remote-title-page");

    fireEvent.click(screen.getByRole("button", { name: FIND_STREAMS }));

    await screen.findByTestId("remote-streams");
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:1" } },
    ]);
  });

  test("an episode press opens its Streams, and the Play still opens the chosen one", async () => {
    const { host } = mountStack(answering(SERIES), titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }));
    await screen.findByTestId("remote-title-page");

    // The press is the play: an episode opens the list for that Video, as the
    // window's Title does (#215).
    fireEvent.click(screen.getByTestId("episode-tt1:1:2"));
    await screen.findByTestId("remote-streams");
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
    ]);
  });

  test("an announced episode stays playable: its press opens its Streams", async () => {
    const { host } = mountStack(answering(UNAIRED), titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }));
    await screen.findByTestId("remote-title-page");

    fireEvent.click(screen.getByTestId("episode-tt1:1:2"));
    await screen.findByTestId("remote-streams");
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
    ]);
  });

  test("a season's first episode is chosen when its chip is pressed", async () => {
    const { host } = mountStack(answering(SERIES), titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }));
    await screen.findByTestId("remote-title-page");

    fireEvent.click(screen.getByRole("button", { name: /Season 2/ }));
    fireEvent.click(screen.getByRole("button", { name: FIND_STREAMS }));

    await screen.findByTestId("remote-streams");
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:2:1" } },
    ]);
  });

  test("opens on the season of the Continue watching Video, with that episode chosen", async () => {
    mountStack(
      answering(SERIES),
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
      {
        ...SNAPSHOT,
        continueWatching: [
          continueEntry({
            video: { id: "tt1:2:1", name: null, season: 2, episode: 1, thumbnail: null, airDate: null },
          }),
        ],
      },
    );
    await screen.findByTestId("remote-title-page");

    expect(screen.getByRole("button", { name: /Season 2/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByTestId("episode-tt1:2:1")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("Resume plays the anchored Video from the Host and opens the player card", async () => {
    const playing: Snapshot = {
      ...SNAPSHOT,
      revision: 2,
      playback: {
        ...SNAPSHOT.playback,
        state: "playing",
        nowPlaying: {
          video: { type: "series", id: "tt1:1:2" },
          addon: "cinemeta",
          name: null,
          description: null,
          filename: null,
          bingeGroup: null,
        },
        position: 300,
        duration: 600,
      },
    };
    const { host } = mountStack(
      answering(SERIES),
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
      { ...SNAPSHOT, continueWatching: [continueEntry()] },
    );
    await screen.findByTestId("remote-title-page");

    fireEvent.click(screen.getByRole("button", { name: "Resume S1E2 · 5 min left" }));

    await waitFor(() =>
      expect(host.asked("resume")).toEqual([
        { type: "resume", video: { type: "series", id: "tt1:1:2" } },
      ]),
    );
    // The Host reports the Stream it took on its next Snapshot; the card is
    // drawn over the Title from there.
    act(() => host.publish(playing));
    expect(await screen.findByTestId("remote-player-card")).toBeInTheDocument();
  });

  test("Play sends the Host the Title whose Up next it reads", async () => {
    const upNext = continueEntry({
      position: null,
      duration: null,
      upNext: true,
    });
    const { host } = mountStack(
      answering(SERIES),
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
      { ...SNAPSHOT, continueWatching: [upNext] },
    );
    await screen.findByTestId("remote-title-page");

    fireEvent.click(screen.getByRole("button", { name: "Play S1E2" }));

    await waitFor(() =>
      expect(host.asked("play_up_next")).toEqual([
        {
          type: "play_up_next",
          title: { type: "series", id: "tt1" },
        },
      ]),
    );
  });

  test("the picker preference opens the Streams for the Up next instead", async () => {
    const upNext = continueEntry({
      position: null,
      duration: null,
      upNext: true,
    });
    const { host } = mountStack(
      answering(SERIES),
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
      {
        ...SNAPSHOT,
        preferences: { ...SNAPSHOT.preferences, upNextPlayback: "picker" },
        continueWatching: [upNext],
      },
    );
    await screen.findByTestId("remote-title-page");

    fireEvent.click(screen.getByRole("button", { name: "Play S1E2" }));

    // The picker is the client's own: no play_up_next leaves, and the Streams
    // for the anchored Video are asked for the way an episode press asks.
    expect(await screen.findByTestId("remote-streams")).toBeInTheDocument();
    expect(host.asked("play_up_next")).toEqual([]);
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
    ]);
  });

  test("a continuity refusal opens the Streams for the Up next instead of alerting", async () => {
    const upNext = continueEntry({
      position: null,
      duration: null,
      upNext: true,
    });
    const respond: Respond = (action) =>
      action.type === "play_up_next"
        ? { kind: "no_up_next_stream", detail: "nothing playable" }
        : answering(SERIES)(action);
    const { host } = mountStack(
      respond,
      titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" }),
      { ...SNAPSHOT, continueWatching: [upNext] },
    );
    await screen.findByTestId("remote-title-page");

    fireEvent.click(screen.getByRole("button", { name: "Play S1E2" }));

    expect(await screen.findByTestId("remote-streams")).toBeInTheDocument();
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
    ]);
  });
});
