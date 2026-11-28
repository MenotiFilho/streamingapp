import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Action, AddonManifest, Snapshot, Stream, Title } from "../../core/wire";
import { TauriLink, type Transport } from "../tauriLink";
import { Shell } from "../Shell";

/**
 * The repertory gate's one journey, first half: Home → Title → Streams → Back →
 * Title → Back → Home, with every Action at the boundary and focus restored
 * where it was left. #158 extends it through play → OSD → Stop.
 *
 * The DOM is the harness: a card is found and pressed, and the assertions are
 * the Actions the fake Host was sent, the Level on the stack, and the control
 * that holds focus (ADR-0032, `docs/agents/testing.md`).
 */

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["series"], idPrefixes: ["tt"] }],
  types: ["series"],
  catalogs: [
    {
      type: "series",
      id: "top",
      name: "Popular",
      extra: [
        { name: "skip", isRequired: false, options: [], optionsLimit: 0 },
      ],
    },
  ],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const TORRENTIO: AddonManifest = {
  ...CINEMETA,
  id: "torrentio",
  name: "Torrentio",
  resources: [{ name: "stream", types: ["series"], idPrefixes: ["tt"] }],
  catalogs: [],
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
  addons: [CINEMETA, TORRENTIO],
  featuredCatalog: { addon: "cinemeta", catalog: { type: "series", id: "top" } },
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

const SERIES: Title = {
  addon: "cinemeta",
  id: "tt0903747",
  key: { kind: "addon", addon: "cinemeta", id: "tt0903747" },
  type: "series",
  name: "Breaking Bad",
  poster: "https://images.test/bb-poster.jpg",
  background: "https://images.test/bb-backdrop.jpg",
  logo: null,
  description: "A chemistry teacher turns to crime.",
  releaseInfo: "2008",
  runtime: "49 min",
  imdbRating: "9.5",
  genres: ["Crime"],
  videos: [
    {
      id: "tt0903747:1:1",
      name: "Pilot",
      season: 1,
      episode: 1,
      thumbnail: null,
      airDate: null,
    },
  ],
};

const STREAM: Stream = {
  name: "Torrentio\n4k HDR",
  description: "Breaking Bad S01E01 2160p BluRay",
  playback: { kind: "direct", url: "https://stream.example.org/bb-s1e1.mkv" },
  warnings: [],
  filename: "Breaking.Bad.S01E01.2160p.mkv",
  bingeGroup: null,
};

function fakeHost() {
  const invocations: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const listeners = new Map<string, (event: { payload: Snapshot }) => void>();

  const transport: Transport = {
    invoke: async <T,>(command: string, args?: Record<string, unknown>): Promise<T> => {
      invocations.push({ command, args });
      if (command === "snapshot") {
        return SNAPSHOT as T;
      }
      const action = (args?.envelope as { action?: Action } | undefined)?.action;
      switch (action?.type) {
        case "browse_catalog":
          return {
            snapshots: [],
            answer: {
              catalogs: [
                {
                  addon: "cinemeta",
                  type: "series",
                  id: "top",
                  name: "Popular",
                  sent: 1,
                  metas: [
                    {
                      id: "tt0903747",
                      type: "series",
                      name: "Breaking Bad",
                      poster: "https://images.test/bb-poster.jpg",
                      posterShape: "poster",
                      background: "https://images.test/bb-backdrop.jpg",
                      releaseInfo: "2008",
                      imdbRating: "9.5",
                      genres: ["Crime"],
                      description: "A chemistry teacher turns to crime.",
                    },
                  ],
                  failure: null,
                },
              ],
            },
          } as T;
        case "open_title":
          return { snapshots: [], answer: { title: SERIES } } as T;
        case "find_streams":
          return {
            snapshots: [],
            answer: { streams: [{ addon: "torrentio", streams: [STREAM], failure: null }] },
          } as T;
        default:
          return { snapshots: [], answer: null } as T;
      }
    },
    listen: async <T,>(event: string, handler: (event: { payload: T }) => void) => {
      const listener = handler as (event: { payload: Snapshot }) => void;
      listeners.set(event, listener);
      listener({ payload: SNAPSHOT });
      return () => {
        if (listeners.get(event) === listener) {
          listeners.delete(event);
        }
      };
    },
  };

  return {
    client: new TauriLink(transport),
    invocations,
    actions(): Action[] {
      return invocations
        .filter(({ command }) => command === "dispatch")
        .map(({ args }) => (args?.envelope as { action: Action }).action);
    },
  };
}

describe("the repertory Title and Streams journey", () => {
  test("Home → Title → Streams and back restores each level's focus", async () => {
    const host = fakeHost();
    render(<Shell client={host.client} />);

    const card = await screen.findByTestId("card-cinemeta-tt0903747");
    await waitFor(() => expect(card).toBeInTheDocument());

    fireEvent.click(card);

    const episode = await screen.findByTestId("episode-tt0903747:1:1");
    expect(host.actions()).toContainEqual({
      type: "open_title",
      addon: "cinemeta",
      title: { type: "series", id: "tt0903747" },
    });

    fireEvent.click(episode);

    await screen.findByTestId("streams");
    expect(host.actions()).toContainEqual({
      type: "find_streams",
      video: { type: "series", id: "tt0903747:1:1" },
    });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByTestId("streams")).not.toBeInTheDocument());
    expect(document.activeElement, "the episode the Streams were opened from").toBe(episode);

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("title-tt0903747")).not.toBeInTheDocument(),
    );
    expect(document.activeElement, "the card the Title was opened from").toBe(card);
  });
});
