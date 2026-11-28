import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { useCallback, useState, type ReactNode } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { actionKey } from "../../core/actionKey";
import { HomeStore } from "../../core/homeStore";
import type { Action, AddonManifest, AddonStreams, Snapshot, Stream, Title } from "../../core/wire";
import { ShellContext, type ActionOutcome, type ShellContextValue } from "../context";
import { quietSession } from "../session.testing";
import { MarqueeStreamsLoader, MarqueeStreamsScreen } from "./MarqueeStreams";

let previousSkipAnimations: boolean | undefined;
beforeAll(() => {
  previousSkipAnimations = MotionGlobalConfig.skipAnimations;
  MotionGlobalConfig.skipAnimations = true;
});
afterAll(() => {
  MotionGlobalConfig.skipAnimations = previousSkipAnimations;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const TORRENTIO: AddonManifest = {
  id: "torrentio",
  name: "Torrentio",
  version: "0.0.14",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const COMET: AddonManifest = {
  ...TORRENTIO,
  id: "comet",
  name: "Comet",
};

const MEDIAFUSION: AddonManifest = {
  ...TORRENTIO,
  id: "mediafusion",
  name: "MediaFusion",
};

const SNAPSHOT: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    autoplay: null,
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    buffered: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: null,
    volume: null,
    muted: null,
    subtitleDelay: null,
    stalled: false,
    torrent: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: {
    subtitleLanguages: [],
    audioLanguages: [],
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
    torrentCache: { megabytes: 2000 },
    upNextPlayback: "direct",
    autoplay: true,
  },
  addons: [TORRENTIO, COMET, MEDIAFUSION],
  featuredCatalog: null,
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

const SERIES: Title = {
  addon: "cinemeta",
  id: "tt11280740",
  key: { kind: "addon", addon: "cinemeta", id: "tt11280740" },
  type: "series",
  name: "Severance",
  poster: null,
  background: "https://images.test/sev-backdrop.jpg",
  logo: "https://images.test/sev-logo.png",
  description: null,
  releaseInfo: "2022–",
  runtime: "49 min",
  imdbRating: "8.6",
  genres: ["Drama"],
  videos: [
    {
      id: "tt11280740:2:3",
      name: "Who Is Alive?",
      season: 2,
      episode: 3,
      thumbnail: null,
      airDate: "2025-01-31",
    },
  ],
};

const TORRENT_4K: Stream = {
  name: "Torrentio\n4k DV",
  description: "Severance S02E03 2160p\n👤 214 💾 8.4 GB ⚙️ ThePirateBay",
  playback: {
    kind: "torrent",
    infoHash: "a584351126afcf50d32be068f3c9a62550d41ecc",
    fileIdx: 0,
    sources: ["tracker:udp://tracker.example.org:1337"],
  },
  warnings: ["p2p"],
  filename: "Severance.S02E03.2160p.ATVP.mkv",
  bingeGroup: "torrentio|4k",
};

const DIRECT_HD: Stream = {
  name: "Comet\n1080p",
  description: "Severance S02E03 1080p\n💾 1.8 GB 🌐 Comet · direct",
  playback: { kind: "direct", url: "https://comet.example/s2e3.mkv" },
  warnings: ["proxy_headers"],
  filename: "Severance.S02E03.1080p.mkv",
  bingeGroup: null,
};

const UNPLAYABLE: Stream = {
  name: "Torrentio\n4k HDR",
  description: "Severance S02E03 2160p",
  playback: { kind: "direct", url: "ftp://example.test/s2e3.mkv" },
  warnings: [],
  filename: "Severance.S02E03.Unplayable.mkv",
  bingeGroup: null,
};

function harness(overrides: Partial<ShellContextValue> = {}) {
  const take = vi.fn(async (_action: Action) => null);
  const ask = (overrides.ask ??
    vi.fn(async (_action: Action) => ({ response: null, error: null }))) as ShellContextValue["ask"];
  const value: ShellContextValue = {
    session: quietSession(ask),
    snapshot: SNAPSHOT,
    error: null,
    destination: "home",
    chosenDestination: false,
    popover: null,
    unplayable: new Set<string>(),
    pending: new Set<string>(),
    markUnplayable: vi.fn(),
    choose: vi.fn(),
    push: vi.fn(() => "level-1"),
    remove: vi.fn(),
    levelExists: vi.fn(() => true),
    pop: vi.fn(),
    back: vi.fn(),
    ask,
    take,
    hint: vi.fn(),
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn(() => () => {}),
    ...overrides,
  };

  return { value, take, ask };
}

function withShell(value: ShellContextValue, children: ReactNode) {
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

describe("MarqueeStreamsScreen", () => {
  it("filters grouped Stream rows by Addon chip and preserves Host order", () => {
    const { value } = harness();
    render(
      withShell(
        value,
        <MarqueeStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[
            { addon: "torrentio", streams: [TORRENT_4K], failure: null },
            { addon: "comet", streams: [DIRECT_HD], failure: null },
          ]}
        />,
      ),
    );

    expect(screen.getByTestId("streams-torrentio")).toBeInTheDocument();
    expect(screen.getByTestId("streams-comet")).toBeInTheDocument();
    expect(screen.getByTestId("streams-filter-all")).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(screen.getByTestId("streams-filter-comet"));
    expect(screen.getByTestId("streams-filter-comet")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByTestId("streams-torrentio")).toBeNull();
    expect(screen.getByTestId("streams-comet")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("streams-filter-all"));
    expect(screen.getByTestId("streams-torrentio")).toBeInTheDocument();
    expect(screen.getByTestId("streams-comet")).toBeInTheDocument();
  });

  it("sends play_stream for playable candidates and locks every row while pending", async () => {
    let release!: () => void;
    const gate = new Promise<null>((resolve) => {
      release = () => resolve(null);
    });

    function PendingHarness() {
      const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
      const take = useCallback(async (action: Action) => {
        setPending(new Set([actionKey(action)]));
        try {
          return await gate;
        } finally {
          setPending(new Set());
        }
      }, []);
      const { value } = harness({ pending, take });
      return withShell(
        value,
        <MarqueeStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[
            { addon: "torrentio", streams: [TORRENT_4K], failure: null },
            { addon: "comet", streams: [DIRECT_HD], failure: null },
          ]}
        />,
      );
    }

    render(<PendingHarness />);

    const firstButton = within(screen.getByTestId("candidate-torrentio-0")).getByRole("button");
    const secondButton = within(screen.getByTestId("candidate-comet-0")).getByRole("button");
    fireEvent.click(firstButton);

    await waitFor(() => expect(firstButton).toBeDisabled());
    expect(secondButton).toBeDisabled();

    await act(async () => {
      release();
      await gate;
    });
    await waitFor(() => expect(secondButton).toBeEnabled());
  });

  it("refuses unplayable candidates locally without sending play_stream", () => {
    const { value, take } = harness();
    render(
      withShell(
        value,
        <MarqueeStreamsScreen
          title={SERIES}
          video={SERIES.videos[0]!}
          groups={[{ addon: "torrentio", streams: [UNPLAYABLE], failure: null }]}
        />,
      ),
    );

    const button = within(screen.getByTestId("candidate-torrentio-0")).getByRole("button");
    fireEvent.click(button);

    expect(screen.getByTestId("chosen-stream")).toHaveTextContent("Not playable");
    expect(take).not.toHaveBeenCalled();
  });

  it("shows empty state when no configured Addon offers Streams", () => {
    const { value } = harness();
    render(
      withShell(
        value,
        <MarqueeStreamsScreen title={SERIES} video={SERIES.videos[0]!} groups={[]} />,
      ),
    );

    expect(screen.getByTestId("streams-none")).toHaveTextContent(
      "No configured Addon offers Streams for this Video.",
    );
  });
});

describe("MarqueeStreamsLoader per-Addon Try again and failure states", () => {
  it("shows AddonNotice with the Host reason and retries only the failed Addon on Try again", async () => {
    let calls = 0;
    const initialGroups: AddonStreams[] = [
      { addon: "torrentio", streams: [TORRENT_4K], failure: null },
      {
        addon: "mediafusion",
        streams: [],
        failure: { kind: "fetch", detail: "addon_unreachable" },
      },
    ];
    const retriedGroups: AddonStreams[] = [
      // Even if torrentio changed on the wire, retry replaces only mediafusion.
      { addon: "torrentio", streams: [], failure: { kind: "fetch", detail: "changed" } },
      { addon: "mediafusion", streams: [DIRECT_HD], failure: null },
    ];

    const ask = vi.fn(async (_action: Action): Promise<ActionOutcome> => {
      calls += 1;
      return {
        response: {
          snapshots: [],
          answer: { streams: calls === 1 ? initialGroups : retriedGroups },
        },
        error: null,
      };
    });
    const { value } = harness({ ask });

    render(withShell(value, <MarqueeStreamsLoader title={SERIES} video={SERIES.videos[0]!} />));

    const failure = await screen.findByTestId("streams-failure-mediafusion");
    expect(failure).toHaveTextContent("MediaFusion did not answer");
    expect(failure).toHaveTextContent("addon_unreachable");

    fireEvent.click(within(failure).getByRole("button", { name: "Try again" }));

    await waitFor(() =>
      expect(screen.getByTestId("candidate-mediafusion-0")).toBeInTheDocument(),
    );
    expect(ask).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("candidate-torrentio-0")).toBeInTheDocument();
  });

  it("shows an error EmptyState when find_streams itself fails and retries on Try again", async () => {
    let calls = 0;
    const ask = vi.fn(async (): Promise<ActionOutcome> => {
      calls += 1;
      if (calls === 1) {
        return { response: null, error: { kind: "unreachable", detail: "offline" } };
      }
      return {
        response: {
          snapshots: [],
          answer: { streams: [{ addon: "torrentio", streams: [TORRENT_4K], failure: null }] },
        },
        error: null,
      };
    });
    const { value } = harness({ ask });

    render(withShell(value, <MarqueeStreamsLoader title={SERIES} video={SERIES.videos[0]!} />));

    const alert = await screen.findByTestId("streams-failure");
    expect(alert).toHaveTextContent("offline");

    fireEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(screen.getByTestId("candidate-torrentio-0")).toBeInTheDocument(),
    );
  });
});
