import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MotionGlobalConfig } from "motion/react";
import { useSyncExternalStore } from "react";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

import { DELAY_STEP, stepDelay, stepScale } from "../core/controls";
import { episodesOf } from "../core/episodes";
import type { HostLink } from "../core/link";
import {
  marqueeAudioOptions,
  marqueeChaptersPanel,
  marqueeDetailsPanel,
  marqueePicturePanel,
  marqueeSubtitleOptions,
} from "../core/playerPanels";
import { Session } from "../core/session";
import { seasonName } from "../core/title";
import type {
  Action,
  AddonStreams,
  PlaybackSnapshot,
  Snapshot,
  Stream,
  Title,
  Track,
  Video,
} from "../core/wire";
import { REMOTE_MENUS } from "../kit/marquee/phone/RemoteMenus";
import { RemoteApp } from "./RemoteApp";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { PlayerSheets } from "./PlayerSheets";
import { NO_EPISODES, SHEET_TITLES, type PlayerSheetName } from "./playerSheets";
import { CARD_NAME, STRIP_EXPAND, STRIP_LABEL } from "./playerScreen";

/**
 * The fullscreen Remote's seven sheets over a fake HostLink (#214, #364,
 * ADR-0032).
 *
 * A sheet's rows are the core's; these cases read what a press does at the
 * boundary — one Action, the core's own value — the order the sheet draws the
 * core's choices in, the Episodes press that hands the episode to the room, and
 * the Streams sheet's switch, refusal and retry. The drawing is the harness
 * throughout.
 */

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

afterAll(() => {
  MotionGlobalConfig.skipAnimations = false;
});

function track(held: Partial<Track> & Pick<Track, "id" | "kind">): Track {
  return {
    language: null,
    title: null,
    codec: null,
    embedded: true,
    selected: false,
    default: false,
    forced: false,
    hearingImpaired: false,
    ...held,
  };
}

const TRACKS: Track[] = [
  track({ id: 1, kind: "audio", title: "Commentary", embedded: false }),
  track({ id: 2, kind: "audio", language: "en", title: "English audio", selected: true }),
  track({ id: 3, kind: "subtitle", language: "en", title: "English text", selected: true }),
  track({ id: 4, kind: "subtitle", language: "pt", title: "Portuguese text", embedded: false }),
];

const PLAYBACK: PlaybackSnapshot = {
  state: "playing",
  autoplay: null,
  picture: "in_window",
  failure: null,
  nowPlaying: {
    video: { type: "series", id: "tt1:1:2" },
    addon: "torrentio",
    name: "Torrentio\n4k DV",
    description: null,
    filename: "episode.mkv",
    bingeGroup: null,
  },
  episode: { season: 1, episode: 2 },
  position: 300,
  duration: 600,
  buffered: null,
  tracks: TRACKS,
  chapters: [
    { index: 0, title: "Opening", time: 0 },
    { index: 1, title: "The Choice", time: 300 },
  ],
  chapter: 0,
  speed: 1,
  volume: 60,
  muted: false,
  subtitleDelay: 0.2,
  stalled: false,
  torrent: null,
  crop: null,
  aspect: null,
  resolution: { width: 1280, height: 720 },
  statistics: { bitrate: 4_000_000, droppedFrames: 0, hardwareDecode: "d3d11va" },
};

const SERIES: Title = {
  addon: "cinemeta",
  id: "tt1",
  key: { kind: "addon", addon: "cinemeta", id: "tt1" },
  type: "series",
  name: "One",
  poster: null,
  background: null,
  logo: null,
  description: null,
  releaseInfo: null,
  runtime: null,
  imdbRating: null,
  genres: [],
  videos: [
    { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
    { id: "tt1:1:2", name: "The Choice", season: 1, episode: 2, thumbnail: null, airDate: null },
    { id: "tt1:2:1", name: "Seven Thirty-Seven", season: 2, episode: 1, thumbnail: null, airDate: null },
  ],
};

function stream(filename: string, overrides: Partial<Stream> = {}): Stream {
  return {
    name: "Torrentio\n1080p",
    description: null,
    filename,
    bingeGroup: null,
    warnings: [],
    playback: { kind: "direct", url: `https://media.test/${filename}` },
    ...overrides,
  };
}

const CURRENT = stream("episode.mkv");
const OTHER = stream("other.mkv", { warnings: ["p2p"] });
const UNPLAYABLE = stream("magnet.mkv", {
  playback: { kind: "direct", url: "ftp://media.test/magnet.mkv" },
});

const STREAMS: AddonStreams[] = [
  { addon: "torrentio", failure: null, streams: [CURRENT, OTHER, UNPLAYABLE] },
  { addon: "comet", failure: { kind: "unreachable", detail: "timed out" }, streams: [] },
];

function streamsAnswer(streams: AddonStreams[]): Respond {
  return (action: Action) =>
    action.type === "find_streams"
      ? { snapshots: [], answer: { streams } }
      : { snapshots: [], answer: null };
}

/** A mounted sheet that follows the Session's own state, as the room does. */
function Live({
  plate,
  title,
  session,
  onClose,
  onEpisode,
}: {
  plate: PlayerSheetName;
  title: Title | null;
  session: Session;
  onClose: () => void;
  onEpisode: (title: Title, video: Video) => void;
}) {
  const state = useSyncExternalStore(
    session.subscribe,
    session.getState,
    session.getState,
  );
  return (
    <PlayerSheets
      plate={plate}
      title={title}
      session={session}
      state={state}
      onClose={onClose}
      onEpisode={onEpisode}
    />
  );
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup();
  }
});

async function mountSheet(
  plate: PlayerSheetName,
  options: {
    playback?: PlaybackSnapshot;
    scale?: number;
    title?: Title | null;
    respond?: Respond;
  } = {},
) {
  const snapshot: Snapshot = {
    ...NOTHING,
    revision: 2,
    playback: options.playback ?? PLAYBACK,
    preferences: {
      ...NOTHING.preferences,
      subtitleScale: options.scale ?? 1,
    },
  };
  const host = new FakeHost(snapshot, options.respond);
  const session = new Session(host);
  const stop = session.start();
  const onClose = vi.fn();
  const onEpisode = vi.fn();
  const view = render(
    <Live
      plate={plate}
      title={options.title ?? null}
      session={session}
      onClose={onClose}
      onEpisode={onEpisode}
    />,
  );
  cleanups.push(() => {
    stop();
    view.unmount();
  });
  const sheet = await screen.findByRole("dialog", { name: SHEET_TITLES[plate] });
  return { host, session, onClose, onEpisode, view, sheet };
}

/** The room over a fake Host, with a stable state object the link caches. */
function mountRoom(respond?: Respond) {
  const host = new FakeHost(
    { ...NOTHING, revision: 2, playback: PLAYBACK },
    respond,
  );
  const state = host.state();
  const link: HostLink = {
    snapshot: () => host.snapshot(),
    dispatch: (action) => host.dispatch(action),
    onSnapshot: (handler) => host.onSnapshot(handler),
    onRevision: (handler) => host.onRevision(handler),
    state: () => state,
    onState: (handler) => host.onState(handler),
    close: () => host.close(),
  };
  const view = render(<RemoteApp link={link} />);
  cleanups.push(() => view.unmount());
  return { host, view };
}

async function openCard() {
  const strip = await screen.findByLabelText(STRIP_LABEL);
  fireEvent.click(
    within(strip).getByRole("button", { name: new RegExp(STRIP_EXPAND) }),
  );
  return screen.findByRole("region", { name: CARD_NAME });
}

function press(scope: HTMLElement, name: string | RegExp) {
  fireEvent.click(within(scope).getByRole("button", { name }));
}

/** A list's rows, in the order the sheet draws them, by their first line. */
function rows(sheet: HTMLElement, group: string, titles: string[]) {
  const drawn = within(within(sheet).getByRole("group", { name: group })).getAllByRole(
    "button",
  );
  expect(drawn).toHaveLength(titles.length);
  drawn.forEach((row, index) => expect(row).toHaveTextContent(titles[index]!));
  return drawn;
}

describe("the Audio & subtitles sheet", () => {
  test("draws the core's subtitle choices, then its audio choices, in the core's order", async () => {
    const { sheet } = await mountSheet("subtitles");
    const subtitles = marqueeSubtitleOptions(PLAYBACK).options.map((option) => option.title);
    const audio = marqueeAudioOptions(PLAYBACK).options.map((option) => option.title);

    const first = rows(sheet, "Subtitle tracks", subtitles);
    const second = rows(sheet, "Audio tracks", audio);

    expect(
      first.at(-1)!.compareDocumentPosition(second[0]!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a track press sends its Action, and the track in force marks itself pressed", async () => {
    const { host, sheet } = await mountSheet("subtitles");

    expect(within(sheet).getByRole("button", { name: /English audio/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    press(sheet, /Commentary/);
    press(sheet, /Portuguese text/);
    press(sheet, "Off");

    await waitFor(() =>
      expect(host.asked("set_audio_track")).toEqual([
        { type: "set_audio_track", track: 1 },
      ]),
    );
    expect(host.asked("set_subtitle_track")).toEqual([
      { type: "set_subtitle_track", track: 4 },
      { type: "set_subtitle_track", track: null },
    ]);
  });

  test("sync steps a tenth of a second either way, and Reset asks for none", async () => {
    const { host, sheet } = await mountSheet("subtitles");

    press(sheet, "−0.1 s");
    press(sheet, "+0.1 s");
    press(sheet, "Reset");

    await waitFor(() =>
      expect(host.asked("set_subtitle_delay")).toEqual([
        { type: "set_subtitle_delay", seconds: stepDelay(0.2, -DELAY_STEP) },
        { type: "set_subtitle_delay", seconds: stepDelay(0.2, DELAY_STEP) },
        { type: "set_subtitle_delay", seconds: 0 },
      ]),
    );
  });

  test.each([
    ["Smaller", -1],
    ["Larger", 1],
  ] as const)("%s sends the core's next 5% size", async (name, direction) => {
    const { host, sheet } = await mountSheet("subtitles");

    press(sheet, name);

    await waitFor(() =>
      expect(host.asked("set_subtitle_scale")).toEqual([
        { type: "set_subtitle_scale", scale: stepScale(1, direction) },
      ]),
    );
  });

  test.each([
    [0.25, "Smaller", "Larger"],
    [3, "Larger", "Smaller"],
  ] as const)("stops at the %s bound", async (scale, held, open) => {
    const { sheet } = await mountSheet("subtitles", { scale });

    expect(within(sheet).getByRole("button", { name: held })).toBeDisabled();
    expect(within(sheet).getByRole("button", { name: open })).toBeEnabled();
  });

  test("an empty track list draws the core's note verbatim", async () => {
    const empty = { ...PLAYBACK, tracks: [] };
    const { sheet } = await mountSheet("subtitles", { playback: empty });

    for (const note of [
      marqueeAudioOptions(empty).emptyNote,
      marqueeSubtitleOptions(empty).emptyNote,
    ]) {
      expect(within(sheet).getByText(note!)).toBeInTheDocument();
    }
  });
});

describe("the Speed and Chapters sheets", () => {
  test("a speed preset sends set_speed with the core's rate", async () => {
    const { host, sheet } = await mountSheet("speed");

    press(sheet, "0.5×");
    press(sheet, "1.5×");
    press(sheet, "2×");

    await waitFor(() =>
      expect(host.asked("set_speed")).toEqual([
        { type: "set_speed", rate: 0.5 },
        { type: "set_speed", rate: 1.5 },
        { type: "set_speed", rate: 2 },
      ]),
    );
    expect(within(sheet).getByRole("button", { name: /Normal/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("a chapter press sends set_chapter, and the step sends its own Action", async () => {
    const { host, sheet } = await mountSheet("chapters");

    press(sheet, /The Choice/);
    press(sheet, "Next chapter");

    await waitFor(() =>
      expect(host.actions).toEqual([
        { type: "set_chapter", index: 1 },
        { type: "next_chapter" },
      ]),
    );
  });

  test("Previous sends previous_chapter, and each step holds at its own end", async () => {
    const first = await mountSheet("chapters");
    expect(
      within(first.sheet).getByRole("button", { name: "Previous chapter" }),
    ).toBeDisabled();
    first.view.unmount();

    const last = await mountSheet("chapters", { playback: { ...PLAYBACK, chapter: 1 } });
    expect(
      within(last.sheet).getByRole("button", { name: "Next chapter" }),
    ).toBeDisabled();
    press(last.sheet, "Previous chapter");

    await waitFor(() => expect(last.host.actions).toEqual([{ type: "previous_chapter" }]));
  });

  test("a Stream with no chapters says so in the core's words", async () => {
    const none = { ...PLAYBACK, chapters: [], chapter: null };
    const { sheet } = await mountSheet("chapters", { playback: none });

    expect(
      within(sheet).getByText(marqueeChaptersPanel(none).emptyNote!),
    ).toBeInTheDocument();
  });
});

describe("the Picture sheet", () => {
  test("aspect, crop and autocrop send the core's Actions", async () => {
    const { host, sheet } = await mountSheet("picture");
    const picture = marqueePicturePanel(PLAYBACK);
    const aspect = picture.aspect.find((option) => option.title === "4:3")!;
    const crop = picture.crop.find((option) => option.title === "4:3")!;

    press(within(sheet).getByRole("group", { name: "Aspect" }), aspect.title);
    press(within(sheet).getByRole("group", { name: "Crop" }), crop.title);
    press(sheet, picture.autocropLabel);

    await waitFor(() =>
      expect(host.actions).toEqual([aspect.action, crop.action, { type: "autocrop" }]),
    );
  });

  test("offers no Statistics: they are the Details sheet's", async () => {
    const { sheet } = await mountSheet("picture", {
      playback: { ...PLAYBACK, torrent: { phase: "fetching", peers: 12, rate: 1 } },
    });

    expect(within(sheet).queryByRole("button", { name: /statistics/i })).toBeNull();
    expect(within(sheet).queryByText("Peers")).toBeNull();
  });
});

describe("the Details sheet", () => {
  const FETCHING = { phase: "fetching", peers: 12, rate: 4_200_000 } as const;

  function expectRows(sheet: HTMLElement, held: Array<{ label: string; value: string }>) {
    for (const row of held) {
      expect(within(sheet).getByText(row.label)).toBeInTheDocument();
      expect(within(sheet).getByText(row.value)).toBeInTheDocument();
    }
  }

  test("draws a torrent's status and the Statistics, and sends nothing", async () => {
    const playback = { ...PLAYBACK, torrent: FETCHING };
    const { host, sheet } = await mountSheet("details", { playback });
    const details = marqueeDetailsPanel(playback, playback.position);

    expectRows(sheet, details.torrentRows!);
    expectRows(sheet, details.playbackRows);
    expect(host.actions).toEqual([]);
  });

  test("a direct Stream has the Statistics and no Torrent status", async () => {
    const { sheet } = await mountSheet("details");

    expect(within(sheet).getByTestId("details-direct-note")).toBeInTheDocument();
    expect(within(sheet).queryByText("Peers")).toBeNull();
    expectRows(sheet, marqueeDetailsPanel(PLAYBACK, PLAYBACK.position).playbackRows);
  });
});

describe("the Streams sheet", () => {
  test("asks for the playing Video's Streams, and marks the one playing", async () => {
    const { host, sheet } = await mountSheet("streams", {
      respond: streamsAnswer(STREAMS),
    });

    const current = await within(sheet).findByRole("button", { name: /episode\.mkv/ });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(within(sheet).getByRole("button", { name: /other\.mkv/ })).not.toHaveAttribute(
      "aria-current",
    );
    expect(host.asked("find_streams")).toEqual([
      { type: "find_streams", video: { type: "series", id: "tt1:1:2" } },
    ]);
  });

  test("a press switches the Stream, never plays it afresh, and puts the sheet away", async () => {
    const { host, sheet, onClose } = await mountSheet("streams", {
      respond: streamsAnswer(STREAMS),
    });

    fireEvent.click(await within(sheet).findByRole("button", { name: /other\.mkv/ }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(host.asked("switch_stream")).toEqual([
      { type: "switch_stream", addon: "torrentio", stream: OTHER },
    ]);
    expect(host.asked("play_stream")).toEqual([]);
  });

  test("a refusal stays on the sheet with the Host's reason", async () => {
    const { sheet, onClose } = await mountSheet("streams", {
      respond: (action) =>
        action.type === "switch_stream"
          ? { kind: "unreachable", detail: "the engine said no" }
          : { snapshots: [], answer: { streams: STREAMS } },
    });

    fireEvent.click(await within(sheet).findByRole("button", { name: /other\.mkv/ }));

    expect(await within(sheet).findByTestId("streams-switch-refusal")).toHaveTextContent(
      "the engine said no",
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(within(sheet).getByRole("button", { name: /other\.mkv/ })).toBeEnabled();
  });

  test("a Stream this Host cannot open stays listed, marked, and sends nothing", async () => {
    const { host, sheet } = await mountSheet("streams", {
      respond: streamsAnswer(STREAMS),
    });

    const held = await within(sheet).findByRole("button", { name: /magnet\.mkv/ });
    expect(held).toBeDisabled();
    expect(within(held).getByTestId("stream-unplayable")).toBeInTheDocument();
    fireEvent.click(held);
    expect(host.asked("switch_stream")).toEqual([]);
  });

  test("Try again asks once more and replaces only the Addon that failed", async () => {
    let asks = 0;
    const answered = stream("comet.mkv");
    const { host, sheet } = await mountSheet("streams", {
      respond: (action) => {
        if (action.type !== "find_streams") {
          return { snapshots: [], answer: null };
        }
        asks += 1;
        return {
          snapshots: [],
          answer: {
            streams:
              asks === 1
                ? STREAMS
                : [
                    { addon: "torrentio", failure: null, streams: [] },
                    { addon: "comet", failure: null, streams: [answered] },
                  ],
          },
        };
      },
    });

    fireEvent.click(await within(sheet).findByRole("button", { name: "Try again" }));

    expect(
      await within(sheet).findByRole("button", { name: /comet\.mkv/ }),
    ).toBeInTheDocument();
    expect(within(sheet).getByRole("button", { name: /other\.mkv/ })).toBeInTheDocument();
    expect(host.asked("find_streams")).toHaveLength(2);
  });

  test("a lookup the Host refused offers Try again for the whole list", async () => {
    let asks = 0;
    const { host, sheet } = await mountSheet("streams", {
      respond: () => {
        asks += 1;
        return asks === 1
          ? { kind: "unreachable", detail: "no answer" }
          : { snapshots: [], answer: { streams: STREAMS } };
      },
    });

    expect(await within(sheet).findByTestId("streams-failure")).toHaveTextContent("no answer");
    press(sheet, "Try again");

    await within(sheet).findByRole("button", { name: /other\.mkv/ });
    expect(host.asked("find_streams")).toHaveLength(2);
  });

  test.each([
    ["no candidate anywhere marks the Title unplayable", [], true],
    ["a candidate clears the mark", [CURRENT], false],
  ])("%s (ADR-0020)", async (_name, streams, unplayable) => {
    let answer: (() => void) | undefined;
    const { session } = await mountSheet("streams", {
      title: SERIES,
      respond: () =>
        new Promise((resolve) => {
          answer = () =>
            resolve({
              snapshots: [],
              answer: { streams: [{ addon: "torrentio", failure: null, streams }] },
            });
        }),
    });
    act(() => session.markUnplayable("tt1", !unplayable));

    await waitFor(() => expect(answer).toBeDefined());
    act(() => answer?.());

    await waitFor(() =>
      expect(session.getState().unplayable.has("tt1")).toBe(unplayable),
    );
  });
});

describe("the Episodes sheet", () => {
  test("lists the Title's seasons and episodes, marking the one playing", async () => {
    const { sheet } = await mountSheet("episodes", { title: SERIES });
    const seasons = within(sheet).getByRole("group", { name: "Seasons" });

    for (const { season } of episodesOf(SERIES)) {
      expect(
        within(seasons).getByRole("button", { name: seasonName(season) }),
      ).toBeInTheDocument();
    }
    expect(within(sheet).getByTestId("episode-tt1:1:2")).toHaveAttribute(
      "aria-current",
      "true",
    );
    expect(within(sheet).queryByTestId("episode-tt1:2:1")).toBeNull();

    press(seasons, seasonName(2));
    expect(within(sheet).getByTestId("episode-tt1:2:1")).toBeInTheDocument();
    expect(within(sheet).queryByTestId("episode-tt1:1:1")).toBeNull();
  });

  test("hands the pressed episode to the room, and asks the Host nothing", async () => {
    const { host, sheet, onClose, onEpisode } = await mountSheet("episodes", {
      title: SERIES,
    });

    press(sheet, /Pilot/);

    // The sheet opens the Streams list the Title's Play opens; it does not pick
    // a candidate behind the person's back (#215, decided on the P2 walk).
    expect(onEpisode).toHaveBeenCalledWith(SERIES, SERIES.videos[0]);
    expect(onClose).not.toHaveBeenCalled();
    expect(host.actions).toEqual([]);
  });

  test("a Title with no seasons says so without asking the Host anything", async () => {
    const { host, sheet } = await mountSheet("episodes", {
      title: { ...SERIES, videos: [] },
    });

    expect(within(sheet).getByTestId("episode-note").textContent).toBe(NO_EPISODES);
    expect(host.actions).toEqual([]);
  });
});

describe("a sheet over the Remote", () => {
  const dialog = (name: string) => screen.queryByRole("dialog", { name });

  test("Escape puts the sheet away and leaves the Remote", async () => {
    mountRoom();
    const card = await openCard();

    press(card, "Subtitles");
    await screen.findByRole("dialog", { name: "Audio & subtitles" });
    // The Remote under the modal is not part of the surface a screen reader or
    // a tab reaches while the sheet is open.
    expect(screen.queryByRole("region", { name: CARD_NAME })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(dialog("Audio & subtitles")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: CARD_NAME })).toBeInTheDocument();
  });

  test.each([
    ["the close control", () => press(screen.getByRole("dialog"), "Close")],
    ["the scrim", () => fireEvent.click(screen.getByTestId("player-sheet-speed-scrim"))],
    ["the browser's Back", () => window.history.back()],
  ])("%s puts the sheet away and leaves the Remote", async (_name, close) => {
    const { host } = mountRoom();
    press(await openCard(), "Speed");
    await screen.findByRole("dialog", { name: "Speed" });

    act(() => void close());

    await waitFor(() => expect(dialog("Speed")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: CARD_NAME })).toBeInTheDocument();
    expect(host.actions).toEqual([]);
  });

  test("a Stream the Host stops takes the sheet and the Remote with it", async () => {
    const { host } = mountRoom();
    press(await openCard(), "Picture");
    await screen.findByRole("dialog", { name: "Picture" });

    act(() =>
      host.publish({
        ...NOTHING,
        revision: 3,
        playback: { ...PLAYBACK, state: "idle", nowPlaying: null, episode: null },
      }),
    );

    await waitFor(() => expect(dialog("Picture")).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: CARD_NAME })).not.toBeInTheDocument();
  });

  test("the Remote's seven menus open their own sheets", async () => {
    mountRoom(streamsAnswer(STREAMS));
    await openCard();

    for (const { id, label } of REMOTE_MENUS) {
      const name = SHEET_TITLES[id];
      press(screen.getByRole("region", { name: CARD_NAME }), label);
      expect(await screen.findByRole("dialog", { name })).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() => expect(dialog(name)).not.toBeInTheDocument());
    }
  });

  test("a switch from the room leaves the Remote up without its sheet", async () => {
    const { host } = mountRoom(streamsAnswer(STREAMS));
    press(await openCard(), "Streams");
    const sheet = await screen.findByRole("dialog", { name: "Streams" });

    fireEvent.click(await within(sheet).findByRole("button", { name: /other\.mkv/ }));

    await waitFor(() => expect(dialog("Streams")).not.toBeInTheDocument());
    expect(screen.getByRole("region", { name: CARD_NAME })).toBeInTheDocument();
    expect(host.asked("switch_stream")).toHaveLength(1);
  });
});
