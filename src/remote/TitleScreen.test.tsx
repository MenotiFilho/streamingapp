import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { describe, expect, test, vi } from "vitest";

import { explain, type ActionError } from "../core/errors";
import type { HostLink } from "../core/link";
import type { NewLevel } from "../core/navigation";
import { useNavigation } from "../core/react/useNavigation";
import { Session } from "../core/session";
import { useSession } from "../core/react/useSession";
import { titleSide } from "../core/titlePage";
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
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { RemoteLevel, type RemotePayload } from "./levels";
import { TitleScreen } from "./TitleScreen";
import {
  FIND_STREAMS,
  TITLE_NO_ANSWER,
  TITLE_RETRY,
  TITLE_UNMAPPED,
  TITLE_UNOPENABLE,
  answeredTitleLevel,
  streamsLevelFor,
} from "./titleScreen";

const POPULAR: AddonCatalog = { type: "movie", id: "top", name: "Popular", extra: [] };

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [POPULAR],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
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
    {
      id: "tt1:1:1",
      name: "Pilot",
      season: 1,
      episode: 1,
      thumbnail: null,
      airDate: "2024-01-17",
      description: "The story begins.",
    },
    {
      id: "tt1:1:2",
      name: "Cat's in the Bag...",
      season: 1,
      episode: 2,
      thumbnail: "https://images.test/s1e2.jpg",
      airDate: null,
      description: "Things escalate fast.",
    },
    {
      id: "tt1:2:1",
      name: "Seven Thirty-Seven",
      season: 2,
      episode: 1,
      thumbnail: null,
      airDate: null,
    },
  ],
};

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

function Harness({
  host,
  initialTitle = FILM,
}: {
  host: FakeHost;
  initialTitle?: Title | null;
}) {
  const link = useMemo(() => doorOf(host), [host]);
  const nav = useNavigation<RemotePayload>();
  const { session, state } = useSession(link);
  const card = { addon: "cinemeta", id: "tt1", type: initialTitle?.type ?? "movie", name: "One" };

  return (
    <RemoteLevel
      level={{
        id: "title-1",
        name: "Title",
        kind: "overlay",
        payload: { kind: "title", title: card, answer: initialTitle },
      }}
      session={session}
      state={state}
      push={nav.push}
      pop={nav.pop}
    />
  );
}

function Stack({
  session,
  level,
}: {
  session: Session;
  level: NewLevel<RemotePayload>;
}) {
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
  level: NewLevel<RemotePayload> = {
    name: "Title",
    kind: "overlay",
    payload: {
      kind: "title",
      title: { addon: "cinemeta", id: "tt1", type: "series", name: "One" },
      answer: null,
    },
  },
  snapshot: Snapshot = SNAPSHOT,
) {
  const host = new FakeHost(snapshot, respond);
  const session = new Session(doorOf(host));
  session.start();
  const view = render(<Stack session={session} level={level} />);
  return { host, session, view };
}

function answering(title: Title = FILM): Respond {
  return (action: Action) => {
    switch (action.type) {
      case "open_title":
        return { snapshots: [], answer: { title } };
      case "find_streams":
        return { snapshots: [], answer: { streams: [] } };
      default:
        return { snapshots: [], answer: null };
    }
  };
}

describe("Title loading and errors", () => {
  test("a StrictMode remount does not ask open_title twice and still takes the answer", async () => {
    const card = { addon: "cinemeta", id: "tt1", type: "movie", name: "One" };
    const host = new FakeHost(SNAPSHOT, (): Response => ({
      snapshots: [],
      answer: { title: FILM },
    }));
    const session = new Session(doorOf(host));
    const push = vi.fn(() => "title-1");

    render(
      <StrictMode>
        <TitleScreen
          levelId="title-1"
          card={card}
          answer={null}
          session={session}
          state={session.getState()}
          push={push}
          pop={() => undefined}
        />
      </StrictMode>,
    );

    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
    expect(host.asked("open_title")).toHaveLength(1);
    expect(push).toHaveBeenCalledWith(answeredTitleLevel(card, FILM, "title-1"));
  });
  test("asks open_title once per level id and replaces in place with answeredTitleLevel", async () => {
    const host = new FakeHost(SNAPSHOT, (): Response => ({
      snapshots: [],
      answer: { title: FILM },
    }));
    const session = new Session(doorOf(host));
    const push = vi.fn(() => "title-1");
    render(
      <TitleScreen
        levelId="title-1"
        card={{ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }}
        answer={null}
        session={session}
        state={session.getState()}
        push={push}
        pop={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        answeredTitleLevel(
          { addon: "cinemeta", id: "tt1", type: "movie", name: "One" },
          FILM,
          "title-1",
        ),
      ),
    );
    expect(host.asked("open_title")).toHaveLength(1);
  });

  test("asks open_discovered_title for TMDB card with addon null", async () => {
    const host = new FakeHost(SNAPSHOT, (): Response => ({
      snapshots: [],
      answer: { title: FILM },
    }));
    const session = new Session(doorOf(host));
    render(
      <TitleScreen
        levelId="title-2"
        card={{ addon: null, id: "tmdb:603", type: "movie", name: "Matrix" }}
        answer={null}
        session={session}
        state={session.getState()}
        push={() => "title-2"}
        pop={() => undefined}
      />,
    );

    await waitFor(() =>
      expect(host.asked("open_discovered_title")).toEqual([
        { type: "open_discovered_title", key: { kind: "tmdb", id: 603 }, kind: "movie" },
      ]),
    );
  });

  test("refusal draws TITLE_RETRY, empty answer draws TITLE_NO_ANSWER, unopenable draws TITLE_UNOPENABLE", async () => {
    const failure: ActionError = { kind: "meta", detail: "addon timed out" };
    let count = 0;
    const host = new FakeHost(SNAPSHOT, () => {
      count += 1;
      return count === 1 ? failure : { snapshots: [], answer: null };
    });
    const session = new Session(doorOf(host));

    const view = render(
      <TitleScreen
        levelId="title-err"
        card={{ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }}
        answer={null}
        session={session}
        state={session.getState()}
        push={() => "title-err"}
        pop={() => undefined}
      />,
    );

    expect(await screen.findByText(explain(failure))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: TITLE_RETRY }));
    expect(await screen.findByText(TITLE_NO_ANSWER)).toBeInTheDocument();

    view.rerender(
      <TitleScreen
        levelId="title-bad"
        card={{ addon: null, id: "unknown-id", type: "movie", name: "Mystery" }}
        answer={null}
        session={session}
        state={session.getState()}
        push={() => "title-bad"}
        pop={() => undefined}
      />,
    );
    expect(await screen.findByText(TITLE_UNOPENABLE)).toBeInTheDocument();
  });
});

describe("Answered Title view at hand scale", () => {
  test("draws facts, synopsis, attribution, Unmapped note, and Choose stream for a film", async () => {
    const host = new FakeHost(SNAPSHOT, (): Response => ({ snapshots: [], answer: { catalogs: [ROW] } }));
    const session = new Session(doorOf(host));
    const push = vi.fn(() => "streams-1");
    render(
      <TitleScreen
        levelId="title-1"
        card={{ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }}
        answer={FILM}
        session={session}
        state={session.getState()}
        push={push}
        pop={() => undefined}
      />,
    );

    expect(screen.getByTestId("title-facts")).toHaveTextContent(
      "IMDb 8.7 · 1999 · 136 min · Sci-Fi",
    );
    expect(screen.getByTestId("title-synopsis")).toHaveTextContent(FILM.description!);
    expect(screen.getByTestId("title-unmapped")).toHaveTextContent(TITLE_UNMAPPED);

    fireEvent.click(screen.getByTestId("title-choose-stream"));
    expect(push).toHaveBeenCalledWith(
      streamsLevelFor(FILM, {
        id: FILM.id,
        name: null,
        season: null,
        episode: null,
        thumbnail: null,
        airDate: null,
      }),
    );
  });

  test("series draws Season chips, episode descriptions and air dates, and tapping episode opens Streams", async () => {
    const entry: ContinueEntry = {
      video: SERIES.videos[0]!,
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
    const host = new FakeHost(
      { ...SNAPSHOT, continueWatching: [entry] },
      (): Response => ({ snapshots: [], answer: null }),
    );
    const pushes: ReturnType<typeof streamsLevelFor>[] = [];
    const link = doorOf(host);
    function SeriesHarness() {
      const { session, state } = useSession(link);
      const [pushed] = useState(() => pushes);
      return (
        <TitleScreen
          levelId="title-series"
          card={{ addon: "cinemeta", id: "tt1", type: "series", name: "One" }}
          answer={SERIES}
          session={session}
          state={state}
          push={(level) => {
            if (level.payload.kind === "streams") {
              pushed.push(level as ReturnType<typeof streamsLevelFor>);
            }
            return `streams-${pushed.length}`;
          }}
          pop={() => undefined}
        />
      );
    }

    render(<SeriesHarness />);

    expect(await screen.findByTestId("title-main-action")).toHaveTextContent(/Resume/i);
    expect(screen.getByTestId("title-choose-stream")).toHaveTextContent("Choose stream");

    const ep1 = screen.getByTestId("episode-tt1:1:1");
    expect(ep1).toHaveTextContent("The story begins.");
    expect(ep1).toHaveTextContent("17 Jan 2024");

    fireEvent.click(screen.getByTestId("season-2"));
    expect(screen.getByTestId("episode-tt1:2:1")).toHaveTextContent("Seven Thirty-Seven");

    fireEvent.click(within(screen.getByTestId("episode-tt1:2:1")).getByRole("button"));
    expect(pushes).toEqual([streamsLevelFor(SERIES, SERIES.videos[2]!)]);
  });

  test("Resume main CTA dispatches Host resume action", async () => {
    const entry: ContinueEntry = {
      video: SERIES.videos[0]!,
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
    const host = new FakeHost(
      { ...SNAPSHOT, continueWatching: [entry] },
      (): Response => ({ snapshots: [], answer: null }),
    );
    render(<Harness host={host} initialTitle={SERIES} />);

    const resumeButton = await screen.findByTestId("title-main-action");
    await act(async () => {
      fireEvent.click(resumeButton);
      await Promise.resolve();
    });
    expect(host.asked("resume")).toEqual([
      { type: "resume", video: { type: "series", id: "tt1:1:1" } },
    ]);
  });

  test("Back pops the Title level cleanly", () => {
    const host = new FakeHost(SNAPSHOT);
    const session = new Session(doorOf(host));
    const pop = vi.fn();
    render(
      <TitleScreen
        levelId="title-1"
        card={{ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }}
        answer={FILM}
        session={session}
        state={session.getState()}
        push={() => "x"}
        pop={pop}
      />,
    );

    expect(FIND_STREAMS).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(pop).toHaveBeenCalledOnce();
  });

  test("a series with no episodes renders the series-empty fallback", async () => {
    const emptySeries: Title = { ...SERIES, videos: [] };
    const expected = titleSide(emptySeries);
    if (expected.kind !== "series-empty") {
      throw new Error("expected series-empty");
    }
    const host = new FakeHost(SNAPSHOT);
    const session = new Session(doorOf(host));
    render(
      <TitleScreen
        levelId="title-empty"
        card={{ addon: "cinemeta", id: "tt1", type: "series", name: "One" }}
        answer={emptySeries}
        session={session}
        state={session.getState()}
        push={() => "x"}
        pop={() => undefined}
      />,
    );

    expect(screen.getByTestId("title-no-videos")).toHaveTextContent(expected.note);
    expect(screen.getByText(expected.kicker)).toBeInTheDocument();
  });

  test("an announced future episode stays playable and tapping it opens Streams", async () => {
    const unaired: Title = {
      ...SERIES,
      videos: SERIES.videos.map((v) =>
        v.id === "tt1:1:2" ? { ...v, airDate: "2999-01-02" } : v,
      ),
    };
    const { host } = mountStack(answering(unaired));
    await screen.findByTestId("remote-title-screen");
    await screen.findByTestId("episode-tt1:1:2");

    fireEvent.click(within(screen.getByTestId("episode-tt1:1:2")).getByRole("button"));
    expect(await screen.findByTestId("remote-streams-screen")).toBeInTheDocument();
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
    ]);
  });

  test("Continue watching anchors on the entry's season and episode for Choose stream", async () => {
    const entry: ContinueEntry = {
      video: SERIES.videos[2]!,
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
    const { host } = mountStack(answering(SERIES), undefined, {
      ...SNAPSHOT,
      continueWatching: [entry],
    });
    await screen.findByTestId("episode-tt1:2:1");

    expect(screen.getByTestId("season-2")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTestId("title-choose-stream"));
    expect(await screen.findByTestId("remote-streams-screen")).toBeInTheDocument();
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:2:1" } },
    ]);
  });

  test("Play on an Up next dispatches play_up_next and pushes player", async () => {
    const upNext: ContinueEntry = {
      video: SERIES.videos[1]!,
      title: {
        addon: "cinemeta",
        id: "tt1",
        type: "series",
        name: "One",
        poster: null,
        background: null,
      },
      position: null,
      duration: null,
      watched: false,
      upNext: true,
      unplayable: null,
    };
    const { host } = mountStack(answering(SERIES), undefined, {
      ...SNAPSHOT,
      continueWatching: [upNext],
    });
    const main = await screen.findByTestId("title-main-action");
    expect(main).toHaveTextContent(/Play/i);

    fireEvent.click(main);
    await waitFor(() =>
      expect(host.asked("play_up_next")).toEqual([
        { type: "play_up_next", title: { type: "series", id: "tt1" } },
      ]),
    );
  });

  test("upNextPlayback picker opens Streams for the Up next without sending play_up_next", async () => {
    const upNext: ContinueEntry = {
      video: SERIES.videos[1]!,
      title: {
        addon: "cinemeta",
        id: "tt1",
        type: "series",
        name: "One",
        poster: null,
        background: null,
      },
      position: null,
      duration: null,
      watched: false,
      upNext: true,
      unplayable: null,
    };
    const { host } = mountStack(answering(SERIES), undefined, {
      ...SNAPSHOT,
      preferences: { ...SNAPSHOT.preferences, upNextPlayback: "picker" },
      continueWatching: [upNext],
    });

    fireEvent.click(await screen.findByTestId("title-main-action"));
    expect(await screen.findByTestId("remote-streams-screen")).toBeInTheDocument();
    expect(host.asked("play_up_next")).toEqual([]);
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
    ]);
  });

  test("a continuity refusal (no_up_next_stream) opens Streams instead of alerting", async () => {
    const upNext: ContinueEntry = {
      video: SERIES.videos[1]!,
      title: {
        addon: "cinemeta",
        id: "tt1",
        type: "series",
        name: "One",
        poster: null,
        background: null,
      },
      position: null,
      duration: null,
      watched: false,
      upNext: true,
      unplayable: null,
    };
    const { host } = mountStack(
      (action) =>
        action.type === "play_up_next"
          ? { kind: "no_up_next_stream", detail: "nothing playable" }
          : answering(SERIES)(action),
      undefined,
      { ...SNAPSHOT, continueWatching: [upNext] },
    );

    fireEvent.click(await screen.findByTestId("title-main-action"));
    expect(await screen.findByTestId("remote-streams-screen")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await waitFor(() =>
      expect(host.asked("find_streams")).toEqual([
        { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
      ]),
    );
  });

  test("the main control guards against double-press while pending", async () => {
    const upNext: ContinueEntry = {
      video: SERIES.videos[1]!,
      title: {
        addon: "cinemeta",
        id: "tt1",
        type: "series",
        name: "One",
        poster: null,
        background: null,
      },
      position: null,
      duration: null,
      watched: false,
      upNext: true,
      unplayable: null,
    };
    let release!: (answer: Response) => void;
    const held = new Promise<Response>((resolve) => {
      release = resolve;
    });
    const { host } = mountStack(
      (action) => (action.type === "play_up_next" ? held : answering(SERIES)(action)),
      undefined,
      { ...SNAPSHOT, continueWatching: [upNext] },
    );

    const main = await screen.findByTestId("title-main-action");
    fireEvent.click(main);
    await waitFor(() => expect(main).toBeDisabled());

    fireEvent.click(main);
    expect(host.asked("play_up_next")).toHaveLength(1);

    await act(async () => {
      release({ snapshots: [], answer: null });
      await held;
    });
    await waitFor(() => expect(main).toBeEnabled());
  });
});
