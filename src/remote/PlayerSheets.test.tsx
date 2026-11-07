import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useSyncExternalStore } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import type { HostLink } from "../core/link";
import {
  DELAY_STEP,
  statisticsLines,
  stepDelay,
} from "../core/controls";
import { episodesOf } from "../core/episodes";
import {
  audioSection,
  pictureSections,
  subtitleSections,
} from "../core/playerPanels";
import { Session } from "../core/session";
import { labelOf, seasonName } from "../core/title";
import type {
  PlaybackSnapshot,
  Snapshot,
  Title,
  Track,
  Video,
} from "../core/wire";
import { RemoteApp } from "./RemoteApp";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { PlayerSheets } from "./PlayerSheets";
import {
  episodeLabel,
  NO_EPISODES,
  PLAYER_SHEET_CONTROLS,
  SHEET_TITLES,
  sheetGroups,
  type PlayerSheetName,
} from "./playerSheets";
import { CARD_NAME, STRIP_EXPAND, STRIP_LABEL } from "./playerScreen";

/**
 * The Remote player's sheets over a fake HostLink (#214, ADR-0032).
 *
 * A plate's rows are the core's; these cases read what a press does at the
 * boundary — one Action, the core's own value — the order the composition puts
 * the core's groups in, the one toggle this client owns, and the Episodes
 * press that plays the first candidate the Host can open. The drawing is the
 * harness throughout.
 */

const TRACKS: Track[] = [
  {
    id: 1,
    kind: "audio",
    language: null,
    title: "Commentary",
    codec: null,
    embedded: false,
    selected: false,
    default: false,
    forced: false,
  },
  {
    id: 2,
    kind: "audio",
    language: "en",
    title: "English",
    codec: null,
    embedded: true,
    selected: true,
    default: true,
    forced: false,
  },
  {
    id: 3,
    kind: "subtitle",
    language: "en",
    title: "English",
    codec: null,
    embedded: true,
    selected: true,
    default: false,
    forced: false,
  },
  {
    id: 4,
    kind: "subtitle",
    language: "pt",
    title: "Portuguese",
    codec: null,
    embedded: false,
    selected: false,
    default: false,
    forced: false,
  },
];

const PLAYBACK: PlaybackSnapshot = {
  state: "playing",
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
    title?: Title | null;
    respond?: Respond;
  } = {},
) {
  const snapshot: Snapshot = {
    ...NOTHING,
    revision: 2,
    playback: options.playback ?? PLAYBACK,
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
  await waitFor(() => expect(session.getState().snapshot).not.toBeNull());
  return { host, session, onClose, onEpisode, view };
}

/** One row's Action, read from the core's own sections. */
function rowAction(groups: ReturnType<typeof pictureSections>, key: string) {
  const row = groups.flatMap((group) => group.rows).find((held) => held.key === key);
  if (!row || row.kind === "note" || row.kind === "readout" || row.action === null) {
    throw new Error(`no action row ${key}`);
  }
  return row.action;
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

describe("the Audio & Subtitles plate", () => {
  test("composes the core's audio groups before its subtitle groups, in the core's order", async () => {
    await mountSheet("audio");
    const sheet = await screen.findByRole("dialog", { name: "Audio & Subtitles" });

    const expected = sheetGroups("audio", PLAYBACK, 1, false).flatMap((group) =>
      group.rows.map((row) => row.key),
    );
    const rendered = within(sheet)
      .getAllByTestId(/^(track-|subtitles-off|subtitle-|delay-)/)
      .map((node) => node.getAttribute("data-testid"));

    expect(rendered).toEqual(expected);
  });

  test("a track press sends its Action, and the track in force marks itself pressed", async () => {
    const { host } = await mountSheet("audio");
    const sheet = await screen.findByRole("dialog", { name: "Audio & Subtitles" });

    const current = within(sheet).getByTestId("track-audio-2");
    expect(current).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(within(sheet).getByTestId("track-audio-1"));
    fireEvent.click(within(sheet).getByTestId("track-subtitle-4"));
    fireEvent.click(within(sheet).getByTestId("subtitles-off"));

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

  test("the delay's steps and reset send the core's seconds", async () => {
    const { host } = await mountSheet("audio");
    const sheet = await screen.findByRole("dialog", { name: "Audio & Subtitles" });

    fireEvent.click(within(sheet).getByTestId("delay-back"));
    fireEvent.click(within(sheet).getByTestId("delay-forward"));
    fireEvent.click(within(sheet).getByTestId("delay-reset"));

    await waitFor(() =>
      expect(host.asked("set_subtitle_delay")).toEqual([
        { type: "set_subtitle_delay", seconds: stepDelay(0.2, -DELAY_STEP) },
        { type: "set_subtitle_delay", seconds: stepDelay(0.2, DELAY_STEP) },
        { type: "set_subtitle_delay", seconds: 0 },
      ]),
    );
  });

  test("an empty track list draws the core's note verbatim", async () => {
    const empty = { ...PLAYBACK, tracks: [] };
    await mountSheet("audio", { playback: empty });
    const sheet = await screen.findByRole("dialog", { name: "Audio & Subtitles" });

    const audioNote = audioSection(empty).rows[0]!;
    if (audioNote.kind !== "note") {
      throw new Error("the audio section has no note");
    }
    expect(within(sheet).getByTestId(audioNote.key).textContent).toBe(audioNote.text);

    const subtitleNote = subtitleSections(empty, 1)[0]!.rows[0]!;
    if (subtitleNote.kind !== "note") {
      throw new Error("the subtitle section has no note");
    }
    expect(within(sheet).getByTestId(subtitleNote.key).textContent).toBe(
      subtitleNote.text,
    );
  });
});

describe("the Speed and Chapters plates", () => {
  test("a speed preset sends set_speed with the core's rate", async () => {
    const { host } = await mountSheet("speed");
    const sheet = await screen.findByRole("dialog", { name: "Speed" });

    fireEvent.click(within(sheet).getByTestId("speed-0.5"));
    fireEvent.click(within(sheet).getByTestId("speed-1.5"));
    fireEvent.click(within(sheet).getByTestId("speed-2"));

    await waitFor(() =>
      expect(host.asked("set_speed")).toEqual([
        { type: "set_speed", rate: 0.5 },
        { type: "set_speed", rate: 1.5 },
        { type: "set_speed", rate: 2 },
      ]),
    );
  });

  test("a chapter press sends set_chapter, and the step sends its own Action", async () => {
    const { host } = await mountSheet("chapters");
    const sheet = await screen.findByRole("dialog", { name: "Chapters" });

    fireEvent.click(within(sheet).getByTestId("chapter-1"));
    fireEvent.click(within(sheet).getByTestId("next-chapter"));

    await waitFor(() =>
      expect(host.actions).toEqual([
        { type: "set_chapter", index: 1 },
        { type: "next_chapter" },
      ]),
    );
  });
});

describe("the Picture plate", () => {
  test("aspect, crop and autocrop send the core's Actions", async () => {
    const { host } = await mountSheet("picture");
    const sheet = await screen.findByRole("dialog", { name: "Picture" });
    const sections = pictureSections(PLAYBACK, false);

    fireEvent.click(within(sheet).getByTestId("aspect-4:3"));
    fireEvent.click(within(sheet).getByTestId("crop-4:3"));
    fireEvent.click(within(sheet).getByTestId("autocrop"));

    await waitFor(() =>
      expect(host.actions).toEqual([
        rowAction(sections, "aspect-4:3"),
        rowAction(sections, "crop-4:3"),
        rowAction(sections, "autocrop"),
      ]),
    );
  });

  test("the statistics toggle opens the Player's lines and sends no Action", async () => {
    const { host } = await mountSheet("picture");
    const sheet = await screen.findByRole("dialog", { name: "Picture" });
    const toggle = within(sheet).getByTestId("toggle-statistics");

    expect(within(sheet).queryByTestId("statistics")).toBeNull();
    fireEvent.click(toggle);

    const statistics = await within(sheet).findByTestId("statistics");
    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(host.actions).toEqual([]);
    for (const line of statisticsLines(PLAYBACK.statistics)) {
      expect(within(statistics).getByText(line.label)).toBeInTheDocument();
      expect(within(statistics).getByText(line.value)).toBeInTheDocument();
    }

    fireEvent.click(toggle);
    await waitFor(() => expect(within(sheet).queryByTestId("statistics")).toBeNull());
    expect(host.actions).toEqual([]);
  });
});

describe("the Episodes plate", () => {
  test("lists the Title's seasons and hands the pressed episode to the room", async () => {
    const { host, onClose, onEpisode } = await mountSheet("episodes", {
      title: SERIES,
    });
    const sheet = await screen.findByRole("dialog", { name: "Episodes" });

    for (const { season, videos } of episodesOf(SERIES)) {
      expect(within(sheet).getByText(seasonName(season))).toBeInTheDocument();
      for (const video of videos) {
        expect(
          within(sheet).getByRole("button", { name: episodeLabel(video) }),
        ).toBeInTheDocument();
      }
    }

    const video = SERIES.videos[0]!;
    fireEvent.click(within(sheet).getByTestId(`episode-${video.id}`));

    // The plate opens the Streams list the Title's Play opens; it does not pick
    // a candidate behind the person's back (#215, decided on the P2 walk).
    expect(onEpisode).toHaveBeenCalledWith(SERIES, video);
    expect(onClose).not.toHaveBeenCalled();
    expect(host.asked("find_streams")).toEqual([]);
    expect(host.asked("play_stream")).toEqual([]);
    expect(labelOf(video)).not.toBeNull();
  });

  test("a Title with no seasons says so without asking the Host anything", async () => {
    const { host } = await mountSheet("episodes", {
      title: { ...SERIES, videos: [] },
    });
    const sheet = await screen.findByRole("dialog", { name: "Episodes" });

    expect(within(sheet).getByTestId("episode-note").textContent).toBe(NO_EPISODES);
    expect(host.actions).toEqual([]);
  });
});

describe("a sheet over the card", () => {
  test("Back pops the sheet and leaves the card", async () => {
    mountRoom();
    await openCard();

    fireEvent.click(screen.getByTestId("player-menu-audio"));
    const sheet = await screen.findByRole("dialog", { name: "Audio & Subtitles" });
    expect(sheet).toBeInTheDocument();
    // The card under the modal is not part of the surface a screen reader or
    // a tab reaches while the plate is open.
    expect(screen.queryByRole("region", { name: CARD_NAME })).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Audio & Subtitles" }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("region", { name: CARD_NAME })).toBeInTheDocument();
  });

  test("a Stream the Host stops takes the sheet and the card with it", async () => {
    const { host } = mountRoom();
    await openCard();
    fireEvent.click(screen.getByTestId("player-menu-picture"));
    await screen.findByRole("dialog", { name: "Picture" });

    act(() =>
      host.publish({
        ...NOTHING,
        revision: 3,
        playback: {
          ...PLAYBACK,
          state: "idle",
          nowPlaying: null,
          episode: null,
        },
      }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "Picture" })).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole("region", { name: CARD_NAME }),
    ).not.toBeInTheDocument();
  });

  test("the card's five controls open their own plates", async () => {
    mountRoom();
    await openCard();

    for (const { plate } of PLAYER_SHEET_CONTROLS) {
      const name = SHEET_TITLES[plate];
      fireEvent.click(screen.getByTestId(`player-menu-${plate}`));
      const sheet = await screen.findByRole("dialog", { name });
      expect(sheet).toBeInTheDocument();
      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("dialog", { name })).not.toBeInTheDocument(),
      );
    }
  });
});
