import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type {
  Action,
  AddonManifest,
  AddonStreams,
  MetaPreview,
  Response,
  Snapshot,
  Title,
  Video,
} from "../host-client";
import { ShellContext, type NewShellLevel, type ShellContextValue } from "./context";
import { HomeStore } from "./homeStore";
import { ShellFrame } from "./ShellFrame";
import type { ShellLevel } from "./navigation";
import { useTitleOpener } from "./TitleScreen";

const CINEMETA = "community.stremboxd";
const TORRENTIO = "com.stremio.torrentio.addon";
const AIOSTREAMS = "community.aiostreams";

const ADDON: AddonManifest = {
  id: CINEMETA,
  name: "Stremboxd",
  version: "2.0.0",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: [],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const NOTHING_SAID: Snapshot = {
  revision: 1,
  playback: {
    state: "idle",
    picture: "in_window",
    failure: null,
    nowPlaying: null,
    episode: null,
    position: null,
    duration: null,
    tracks: [],
    chapters: [],
    chapter: null,
    speed: null,
    volume: null,
    muted: null,
    subtitleDelay: null,
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: { subtitleLanguage: null },
  addons: [ADDON],
  featuredCatalog: null,
  protection: { backend: "keyring", tmdbHeld: true, stremioHeld: false },
  watchProgress: [],
  devices: [],
  pairingCode: "4K7Q2M",
  address: "192.168.1.9:8090",
};

function matrixTitle(overrides: Partial<Title> = {}): Title {
  return {
    addon: CINEMETA,
    id: "tt0133093",
    key: { kind: "addon", addon: CINEMETA, id: "tt0133093" },
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix-poster.jpg",
    background: "https://images.test/matrix-backdrop.jpg",
    logo: "https://images.test/matrix-logo.png",
    description: "A hacker learns the truth about his reality.",
    releaseInfo: "1999",
    runtime: "136 min",
    imdbRating: "8.7",
    genres: ["Action", "Science Fiction"],
    videos: [],
    ...overrides,
  };
}

function matrixPreview(overrides: Partial<MetaPreview> = {}): MetaPreview {
  return {
    id: "tt0133093",
    type: "movie",
    name: "The Matrix",
    poster: "https://images.test/matrix-poster.jpg",
    posterShape: "poster",
    background: "https://images.test/matrix-backdrop.jpg",
    releaseInfo: "1999",
    imdbRating: "8.7",
    genres: ["Action", "Science Fiction"],
    description: "A hacker learns the truth about his reality.",
    ...overrides,
  };
}

function episode(
  id: string,
  name: string,
  season: number,
  number: number,
  thumbnail: string | null = null,
): Video {
  return { id, name, season, episode: number, thumbnail };
}

function breakingBadTitle(): Title {
  return matrixTitle({
    id: "tt0903747",
    key: { kind: "addon", addon: CINEMETA, id: "tt0903747" },
    type: "series",
    name: "Breaking Bad",
    poster: "https://images.test/bb-poster.jpg",
    background: "https://images.test/bb-backdrop.jpg",
    logo: null,
    description: "A chemistry teacher turns to crime.",
    releaseInfo: "2008",
    runtime: "49 min",
    imdbRating: "9.5",
    genres: ["Drama"],
    videos: [
      episode("tt0903747:0:1", "Good Cop Bad Cop", 0, 1),
      episode(
        "tt0903747:1:1",
        "Pilot",
        1,
        1,
        "https://images.test/stills/pilot.jpg",
      ),
      episode("tt0903747:1:2", "Cat's in the Bag...", 1, 2),
    ],
  });
}

function streamGroups(): AddonStreams[] {
  return [
    {
      addon: TORRENTIO,
      streams: [
        {
          name: "Torrentio\n4k HDR",
          description: "The Matrix 1999 2160p UHD BluRay x265-GROUP\n👤 100 💾 51.3 GB",
          playback: { kind: "info_hash", infoHash: "8dc393c100ef0c0d010cfefdcebe572e26c4f775" },
          warnings: [],
          filename: "The.Matrix.1999.2160p.UHD.BluRay.x265-GROUP.mkv",
          bingeGroup: "torrentio|4k|BluRay|x265",
        },
      ],
      failure: null,
    },
    {
      addon: AIOSTREAMS,
      streams: [
        {
          name: "AIOStreams\n1080p",
          description: "The Matrix 1999 1080p BluRay x265-GROUP\n💾 4.21 GB ⚙️ TorBox",
          playback: {
            kind: "direct",
            url: "https://stream.example.org/v/tt0133093-1080p.mkv",
          },
          warnings: ["not_web_ready", "proxy_headers"],
          filename: "The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv",
          bingeGroup: null,
        },
      ],
      failure: null,
    },
  ];
}

/**
 * The real frame and level stack over a base card, so opening a Title is the
 * same movement a card makes: an Action, then one pushed level.
 */
function Harness({
  title,
  preview,
  discovered = false,
  streams = streamGroups(),
  actions,
}: {
  title: Title;
  preview: MetaPreview;
  discovered?: boolean;
  streams?: AddonStreams[];
  actions: Action[];
}) {
  const [levels, setLevels] = useState<ShellLevel[]>([]);
  const levelsRef = useRef(levels);
  levelsRef.current = levels;
  const nextLevel = useRef(0);

  const push = (level: NewShellLevel): string => {
    const id = level.id ?? `level-${(nextLevel.current += 1)}`;
    setLevels((held) => {
      const at = held.findIndex((existing) => existing.id === id);
      if (at < 0) {
        return [...held, { ...level, id }];
      }
      const next = held.slice();
      next[at] = { ...level, id };
      return next;
    });
    return id;
  };
  const remove = (id: string) => setLevels((held) => held.filter((level) => level.id !== id));
  const levelExists = (id: string) => levelsRef.current.some((level) => level.id === id);
  const pop = () => setLevels((held) => held.slice(0, -1));

  const take = async (action: Action): Promise<Response | null> => {
    actions.push(action);
    switch (action.type) {
      case "open_title":
      case "open_discovered_title":
        return { snapshots: [], answer: { title } };
      case "find_streams":
        return { snapshots: [], answer: { streams } };
      default:
        return { snapshots: [], answer: null };
    }
  };

  const ask = async (action: Action) => ({
    response: await take(action),
    error: null,
  });

  const value: ShellContextValue = {
    snapshot: NOTHING_SAID,
    error: null,
    destination: "home",
    chosenDestination: false,
    popover: null,
    unplayable: new Set<string>(),
    choose: () => {},
    push,
    remove,
    levelExists,
    pop,
    back: pop,
    ask,
    take,
    markUnplayable: () => {},
    home: new HomeStore(ask),
    setIntentHandler: () => {},
  };

  return (
    <ShellContext.Provider value={value}>
      <ShellFrame
        destination="home"
        onChooseDestination={() => {}}
        levels={levels}
        onBack={pop}
        screen={
          <section data-region="home" data-kind="row" data-label="Home">
            <BaseCard preview={preview} discovered={discovered} />
          </section>
        }
      />
    </ShellContext.Provider>
  );
}

function BaseCard({ preview, discovered }: { preview: MetaPreview; discovered: boolean }) {
  const { openTitle, openDiscoveredTitle } = useTitleOpener();

  return (
    <button
      type="button"
      data-focusable
      data-testid="card-tt0133093"
      onClick={() =>
        void (discovered
          ? openDiscoveredTitle(preview)
          : openTitle(CINEMETA, preview))
      }
    >
      {preview.name}
    </button>
  );
}

async function openTitleOrDiscovered(options: {
  title?: Title;
  preview?: MetaPreview;
  discovered?: boolean;
  streams?: AddonStreams[];
} = {}) {
  const title = options.title ?? matrixTitle();
  const preview = options.preview ?? matrixPreview();
  const actions: Action[] = [];
  render(
    <Harness
      title={title}
      preview={preview}
      discovered={options.discovered}
      streams={options.streams}
      actions={actions}
    />,
  );

  fireEvent.click(await screen.findByTestId("card-tt0133093"));
  await screen.findByTestId(`title-${title.id}`);
  return { title, preview, actions };
}

function actionOf(actions: Action[], type: Action["type"]): Action | undefined {
  return actions.find((action) => action.type === type);
}

/** A DOMRect-shaped answer for the focus engine's measurements. */
function rect(x: number, y: number, w: number, h: number) {
  return {
    x,
    y,
    w,
    h,
    left: x,
    top: y,
    width: w,
    height: h,
    right: x + w,
    bottom: y + h,
    toJSON: () => ({}),
  };
}

/**
 * Answer the focus engine's measurements for the listed elements, and zero for
 * everything else. Restored after every test, so a failed assertion cannot leak
 * the stub into the next one.
 */
function stubRects(entries: Array<[HTMLElement, ReturnType<typeof rect>]>) {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      const found = entries.find(([element]) => element === this);
      return found ? found[1] : rect(0, 0, 0, 0);
    });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Title screen", () => {
  test("an Addon card opens the Title with open_title, and every field is drawn", async () => {
    const { actions } = await openTitleOrDiscovered();

    expect(actions[0]).toEqual({
      type: "open_title",
      addon: CINEMETA,
      title: { type: "movie", id: "tt0133093" },
    });

    expect(screen.getByTestId("title-hero")).toHaveAttribute("data-art", "background");
    expect(screen.getByTestId("title-poster")).toHaveAttribute(
      "src",
      "https://images.test/matrix-backdrop.jpg",
    );
    expect(screen.getByTestId("title-logo")).toHaveAttribute(
      "src",
      "https://images.test/matrix-logo.png",
    );
    expect(screen.getByTestId("title-facts")).toHaveTextContent("8.7");
    expect(screen.getByTestId("title-facts")).toHaveTextContent("1999");
    expect(screen.getByTestId("title-facts")).toHaveTextContent("136 min");
    expect(screen.getByTestId("title-facts")).toHaveTextContent("Science Fiction");
    expect(screen.getByTestId("title-addon")).toHaveTextContent(CINEMETA);
    expect(screen.getByTestId("title-unmapped")).toHaveTextContent("Unmapped");
    expect(screen.getByTestId("title-unmapped")).toHaveTextContent("keyed by its Addon");
  });

  test("a Discovered Title opens with open_discovered_title and the same screen", async () => {
    const title = matrixTitle({
      addon: null,
      key: { kind: "tmdb", id: 603 },
      logo: null,
    });
    const preview = matrixPreview({ id: "tmdb:603" });
    const { actions } = await openTitleOrDiscovered({ title, preview, discovered: true });

    expect(actions[0]).toEqual({
      type: "open_discovered_title",
      key: { kind: "tmdb", id: 603 },
      kind: "movie",
    });

    expect(screen.getByTestId("title-hero")).toHaveAttribute("data-art", "background");
    expect(screen.getByTestId("title-name")).toHaveTextContent("The Matrix");
    expect(screen.queryByTestId("title-addon")).not.toBeInTheDocument();
    expect(screen.queryByTestId("title-unmapped")).not.toBeInTheDocument();
  });

  test("a mapped Addon Title keeps its Addon and loses the Unmapped mark", async () => {
    await openTitleOrDiscovered({
      title: matrixTitle({ key: { kind: "tmdb", id: 603 } }),
    });

    expect(screen.getByTestId("title-addon")).toHaveTextContent(CINEMETA);
    expect(screen.queryByTestId("title-unmapped")).not.toBeInTheDocument();
  });

  test("the poster stands in for an absent backdrop, and the card for a sparse answer", async () => {
    const title = matrixTitle({
      name: "tt0133093",
      poster: null,
      background: null,
      logo: null,
      releaseInfo: null,
      runtime: null,
      imdbRating: null,
      genres: [],
      description: null,
    });
    await openTitleOrDiscovered({
      title,
      preview: matrixPreview({ background: null }),
    });

    expect(screen.getByTestId("title-hero")).toHaveAttribute("data-art", "poster");
    expect(screen.getByTestId("title-poster")).toHaveAttribute(
      "src",
      "https://images.test/matrix-poster.jpg",
    );
    expect(screen.getByTestId("title-name")).toHaveTextContent("The Matrix");
  });

  test("a film is one Video: the film itself, with a Play control", async () => {
    const { actions } = await openTitleOrDiscovered();

    expect(screen.getByTestId("title-no-videos")).toHaveTextContent("one Video");
    const play = screen.getByTestId("play-film");
    expect(play).toHaveTextContent("Play");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" }));

    fireEvent.click(play);

    await screen.findByTestId("streams-heading");
    expect(actionOf(actions, "find_streams")).toEqual({
      type: "find_streams",
      video: { type: "movie", id: "tt0133093" },
    });
  });

  test("a series has horizontal seasons over episode rows, with stills where they exist", async () => {
    const title = breakingBadTitle();
    const preview = matrixPreview({
      id: "tt0903747",
      type: "series",
      name: "Breaking Bad",
      releaseInfo: "2008",
    });
    await openTitleOrDiscovered({ title, preview });

    const seasons = screen.getByTestId("title-seasons");
    expect(
      within(seasons)
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Specials", "Season 1"]);
    expect(screen.getByTestId("season-0")).toHaveAttribute("aria-pressed", "true");

    expect(screen.getByTestId("episode-tt0903747:0:1")).toHaveTextContent(
      "S0E1 · Good Cop Bad Cop",
    );
    expect(screen.queryByTestId("episode-tt0903747:1:1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("season-1"));

    const pilot = screen.getByTestId("episode-tt0903747:1:1");
    expect(pilot).toHaveTextContent("S1E1 · Pilot");
    expect(within(pilot).getByTestId("episode-still")).toHaveAttribute(
      "src",
      "https://images.test/stills/pilot.jpg",
    );
    expect(within(pilot).getByTestId("episode-still").closest("[data-aspect]")).toHaveAttribute(
      "data-aspect",
      "16:9",
    );

    const second = screen.getByTestId("episode-tt0903747:1:2");
    expect(second).toHaveTextContent("S1E2 · Cat's in the Bag...");
    expect(
      second.querySelector("img"),
      "an episode with no still degrades to text rather than a placeholder tile",
    ).toBeNull();

    expect(
      within(screen.getByTestId("title-episodes"))
        .getAllByRole("button")
        .map((row) => row.getAttribute("data-testid")),
      "the source's order is the order",
    ).toEqual(["episode-tt0903747:1:1", "episode-tt0903747:1:2"]);
  });

  test("Down from Back lands on the first season chip", async () => {
    const title = breakingBadTitle();
    const preview = matrixPreview({
      id: "tt0903747",
      type: "series",
      name: "Breaking Bad",
    });
    await openTitleOrDiscovered({ title, preview });

    const back = screen.getByRole("button", { name: "Back" });
    const seasons = screen.getByTestId("title-seasons");
    const specials = screen.getByTestId("season-0");
    const seasonOne = screen.getByTestId("season-1");
    const episodes = screen.getByTestId("title-episodes");

    stubRects([
      [back, rect(40, 40, 120, 44)],
      [seasons, rect(40, 120, 1160, 60)],
      [specials, rect(40, 126, 90, 48)],
      [seasonOne, rect(140, 126, 110, 48)],
      [episodes, rect(40, 220, 1160, 400)],
    ]);

    expect(document.activeElement).toBe(back);
    fireEvent.keyDown(document, { key: "ArrowDown" });

    await waitFor(() => expect(document.activeElement).toBe(specials));
  });

  test("a series whose Addon listed no episodes says so rather than being called a film", async () => {
    const title = breakingBadTitle();
    title.videos = [];
    await openTitleOrDiscovered({ title });

    expect(screen.getByTestId("title-no-videos")).toHaveTextContent("listed no episodes");
    expect(screen.queryByTestId("play-film")).not.toBeInTheDocument();
  });
});

describe("the Streams overlay", () => {
  test("an episode presses find_streams and pushes the list over the still-painted Title", async () => {
    const title = breakingBadTitle();
    const preview = matrixPreview({ id: "tt0903747", type: "series", name: "Breaking Bad" });
    const { actions } = await openTitleOrDiscovered({ title, preview });

    fireEvent.click(screen.getByTestId("season-1"));
    fireEvent.click(screen.getByTestId("episode-tt0903747:1:2"));

    await screen.findByTestId("streams-heading");
    expect(actionOf(actions, "find_streams")).toEqual({
      type: "find_streams",
      video: { type: "series", id: "tt0903747:1:2" },
    });
    expect(screen.getByTestId("streams-heading")).toHaveTextContent(
      "Streams — S1E2 — Cat's in the Bag...",
    );
    expect(
      screen.getByTestId("title-tt0903747"),
      "the Title stays painted underneath",
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Back" })),
    );
  });

  test("Back pops the Streams level to the Title and restores the episode's focus", async () => {
    const title = breakingBadTitle();
    const preview = matrixPreview({ id: "tt0903747", type: "series", name: "Breaking Bad" });
    await openTitleOrDiscovered({ title, preview });

    fireEvent.click(screen.getByTestId("season-1"));
    const episodeButton = screen.getByTestId("episode-tt0903747:1:2");
    fireEvent.click(episodeButton);
    await screen.findByTestId("streams-heading");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByTestId("streams-heading")).not.toBeInTheDocument(),
    );
    expect(document.activeElement).toBe(episodeButton);
    expect(screen.getByTestId("title-tt0903747")).toBeInTheDocument();
  });

  test("Back from the Title returns to the card that opened it", async () => {
    await openTitleOrDiscovered();
    const back = screen.getByRole("button", { name: "Back" });

    fireEvent.click(back);

    await waitFor(() => expect(screen.queryByTestId("title-tt0133093")).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId("card-tt0133093")));
  });

  test("Down from Back enters the first playable Stream past an Addon that answered nothing", async () => {
    const streams: AddonStreams[] = [
      { addon: TORRENTIO, streams: [], failure: null },
      {
        addon: AIOSTREAMS,
        streams: [
          {
            name: "AIOStreams\n1080p",
            description: "The Matrix 1999 1080p BluRay x265-GROUP",
            playback: {
              kind: "direct",
              url: "https://stream.example.org/v/tt0133093-1080p.mkv",
            },
            warnings: [],
            filename: "The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv",
            bingeGroup: null,
          },
        ],
        failure: null,
      },
    ];
    await openTitleOrDiscovered({ streams });
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");

    const back = screen.getByRole("button", { name: "Back" });
    const empty = screen.getByTestId(`streams-${TORRENTIO}`);
    const answered = screen.getByTestId(`streams-${AIOSTREAMS}`);
    const first = screen.getByTestId(`candidate-${AIOSTREAMS}-0`);

    stubRects([
      [back, rect(40, 40, 120, 44)],
      [empty, rect(40, 120, 1160, 60)],
      [answered, rect(40, 220, 1160, 160)],
      [first, rect(40, 240, 1160, 120)],
    ]);

    await waitFor(() => expect(document.activeElement).toBe(back));
    fireEvent.keyDown(document, { key: "ArrowDown" });

    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  test("each Addon's candidates carry badges, filename, description, warnings and the unplayable mark", async () => {
    await openTitleOrDiscovered();
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");

    expect(
      screen.getAllByTestId(/^candidate-/).map((candidate) => candidate.getAttribute("data-testid")),
      "one group per Addon, in the Host's order",
    ).toEqual([`candidate-${TORRENTIO}-0`, `candidate-${AIOSTREAMS}-0`]);

    const first = screen.getByTestId(`candidate-${TORRENTIO}-0`);
    expect(first).toHaveTextContent("Torrentio");
    expect(first).toHaveTextContent("4k HDR");
    expect(within(first).getByTestId("stream-filename")).toHaveTextContent(
      "The.Matrix.1999.2160p.UHD.BluRay.x265-GROUP.mkv",
    );
    expect(first).toHaveTextContent("51.3 GB");
    expect(first).toHaveTextContent("Not playable yet");

    const hinted = screen.getByTestId(`candidate-${AIOSTREAMS}-0`);
    expect(hinted).toHaveTextContent("Not web-ready");
    expect(hinted).toHaveTextContent("Wants request headers");
    expect(within(hinted).getByTestId("stream-filename")).toHaveTextContent(
      "The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv",
    );
  });

  test("a playable candidate dispatches play_stream with the whole candidate and the Title's backdrop", async () => {
    const { actions } = await openTitleOrDiscovered();
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");

    fireEvent.click(screen.getByTestId(`candidate-${AIOSTREAMS}-0`));

    await waitFor(() =>
      expect(actionOf(actions, "play_stream")).toEqual({
        type: "play_stream",
        video: { type: "movie", id: "tt0133093" },
        addon: AIOSTREAMS,
        title: {
          addon: CINEMETA,
          id: "tt0133093",
          type: "movie",
          name: "The Matrix",
          poster: "https://images.test/matrix-poster.jpg",
          background: "https://images.test/matrix-backdrop.jpg",
        },
        stream: {
          name: "AIOStreams\n1080p",
          description: "The Matrix 1999 1080p BluRay x265-GROUP\n💾 4.21 GB ⚙️ TorBox",
          playback: {
            kind: "direct",
            url: "https://stream.example.org/v/tt0133093-1080p.mkv",
          },
          warnings: ["not_web_ready", "proxy_headers"],
          filename: "The.Matrix.1999.1080p.BluRay.x265-GROUP.mkv",
          bingeGroup: null,
        },
      }),
    );
  });

  test("a mapped film plays in TMDB's spelling, so Continue watching unifies", async () => {
    const { actions } = await openTitleOrDiscovered({
      title: matrixTitle({ key: { kind: "tmdb", id: 603 } }),
    });
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");

    expect(screen.getByTestId("streams-heading")).toHaveTextContent("Streams — The Matrix");
    expect(actionOf(actions, "find_streams")).toEqual({
      type: "find_streams",
      video: { type: "movie", id: "tmdb:603" },
    });

    fireEvent.click(screen.getByTestId(`candidate-${AIOSTREAMS}-0`));
    await waitFor(() =>
      expect(actionOf(actions, "play_stream")).toMatchObject({
        type: "play_stream",
        video: { type: "movie", id: "tmdb:603" },
      }),
    );
  });

  test("an unplayable candidate is marked locally and never travels to the Host", async () => {
    const { actions } = await openTitleOrDiscovered();
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");
    const before = actions.length;

    fireEvent.click(screen.getByTestId(`candidate-${TORRENTIO}-0`));

    expect(screen.getByTestId("chosen-stream")).toHaveTextContent("Not playable yet");
    expect(screen.getByTestId("chosen-stream")).toHaveTextContent(
      "a torrent this Host cannot fetch",
    );
    expect(
      actions.slice(before).some((action) => action.type === "play_stream"),
      "an unplayable Stream is not asked of the Host",
    ).toBe(false);
  });

  test("one Addon's failure and another's empty answer stay on their own group", async () => {
    const streams: AddonStreams[] = [
      {
        addon: TORRENTIO,
        streams: [],
        failure: { kind: "fetch", detail: "the Addon answered with status 503" },
      },
      { addon: AIOSTREAMS, streams: [], failure: null },
    ];
    await openTitleOrDiscovered({ streams });
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");

    expect(
      within(screen.getByTestId(`streams-${TORRENTIO}`)).getByRole("alert"),
    ).toHaveTextContent("status 503");
    expect(screen.getByTestId(`streams-${AIOSTREAMS}`)).toHaveTextContent(
      "answered nothing this Host can play",
    );
  });

  test("a Video no Addon offers Streams for says so rather than showing an empty list", async () => {
    await openTitleOrDiscovered({ streams: [] });
    fireEvent.click(screen.getByTestId("play-film"));
    await screen.findByTestId("streams-heading");

    expect(screen.getByTestId("streams-none")).toHaveTextContent(
      "No configured Addon offers Streams for this Video",
    );
  });
});
