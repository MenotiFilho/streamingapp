import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { pictureNote } from "../core/playback";
import { STALLED_NOTE, STALLED_STRIP_NOTE, STALL_GRACE_MS } from "../core/stall";
import type { HostLink } from "../core/link";
import type {
  Action,
  AddonStreams,
  PlaybackSnapshot,
  ResumeEntry,
  Snapshot,
  Title,
} from "../core/wire";
import { RemoteApp } from "./RemoteApp";
import { FakeHost, type Respond } from "./fakeHost.testing";
import { NOTHING } from "./fakeSocket.testing";
import { CARD_NAME, STRIP_EXPAND, STRIP_LABEL } from "./playerScreen";

/**
 * The Remote's player over a fake HostLink (#213, ADR-0032).
 *
 * The assertions are the surface's decisions: the strip and its two controls,
 * the card as the level Back closes without stopping, the six core controls,
 * the timeline's one seek per committed change, the volume box's one level per
 * commit, and the strip's rule for all three picture values. The drawing is the
 * harness; the Action at the boundary is what a case reads.
 */

const EPISODE: ResumeEntry = {
  video: {
    id: "tt1:1:2",
    name: "The Choice",
    season: 1,
    episode: 2,
    thumbnail: null,
    airDate: null,
  },
  title: {
    addon: "torrentio",
    id: "tt1",
    type: "series",
    name: "One",
    poster: null,
    background: "https://images.test/one.jpg",
  },
  position: 300,
  duration: 600,
  watched: false,
  unplayable: null,
};

const WATCHING: PlaybackSnapshot = {
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
  buffered: { start: 300, end: 450 },
  tracks: [],
  chapters: [
    { index: 0, title: "Opening", time: 0 },
    { index: 1, title: "The Choice", time: 300 },
  ],
  chapter: 0,
  speed: 1,
  volume: 60,
  muted: false,
  subtitleDelay: 0,
  stalled: false,
  torrent: null,
  crop: null,
  aspect: null,
  resolution: null,
  statistics: null,
};

function snapshot(overrides: Partial<PlaybackSnapshot> = {}, revision = 2): Snapshot {
  return {
    ...NOTHING,
    revision,
    watchProgress: [EPISODE],
    playback: { ...WATCHING, ...overrides },
  };
}

/** The room over a fake Host: the strip is one of its own bands. */
function mount(respond?: Respond) {
  const host = new FakeHost(snapshot(), respond);
  // The simple fake builds its `ready` state per call, and the app reads it
  // through `useSyncExternalStore`: one stable object per connection is what
  // the real link gives, so the harness gives it too.
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
  return { host, view };
}

async function openCard() {
  const strip = await screen.findByLabelText(STRIP_LABEL);
  fireEvent.click(
    within(strip).getByRole("button", { name: new RegExp(STRIP_EXPAND) }),
  );
  return screen.findByRole("region", { name: CARD_NAME });
}

function strip() {
  return screen.getByLabelText(STRIP_LABEL);
}

describe("the Remote's docked strip", () => {
  test("is drawn for all three picture values, and says where the picture is not here", async () => {
    const { host } = mount();
    await screen.findByLabelText(STRIP_LABEL);

    let revision = 2;
    const elsewhere = [pictureNote("own_window"), pictureNote("nowhere")];
    for (const picture of ["in_window", "own_window", "nowhere"] as const) {
      revision += 1;
      act(() => host.publish(snapshot({ picture }, revision)));
      const band = await screen.findByLabelText(STRIP_LABEL);
      const note = pictureNote(picture);
      if (note === null) {
        for (const absent of elsewhere) {
          expect(within(band).queryByText(absent!)).toBeNull();
        }
      } else {
        expect(within(band).getByText(note)).toBeInTheDocument();
      }
    }
  });

  test("stays docked on every destination", async () => {
    mount();
    await screen.findByLabelText(STRIP_LABEL);

    fireEvent.click(screen.getByRole("button", { name: "Library" }));
    expect(screen.getByLabelText(STRIP_LABEL)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByLabelText(STRIP_LABEL)).toBeInTheDocument();
  });

  test("play/pause sends set_paused with the next state, and follows the Host again", async () => {
    const { host } = mount();
    await screen.findByLabelText(STRIP_LABEL);

    fireEvent.click(within(strip()).getByRole("button", { name: "Pause" }));
    await waitFor(() =>
      expect(host.asked("set_paused")).toEqual([
        { type: "set_paused", paused: true },
      ]),
    );

    act(() => host.publish(snapshot({ state: "paused" }, 3)));
    await waitFor(() =>
      expect(
        within(strip()).getByRole("button", { name: "Play" }),
      ).toBeEnabled(),
    );
    fireEvent.click(within(strip()).getByRole("button", { name: "Play" }));
    await waitFor(() =>
      expect(host.asked("set_paused")).toEqual([
        { type: "set_paused", paused: true },
        { type: "set_paused", paused: false },
      ]),
    );
  });

  test("a pending control is disabled from the Session's key, and a second press sends nothing", async () => {
    let answer: (() => void) | undefined;
    const { host } = mount(
      () =>
        new Promise((resolve) => {
          answer = () => resolve({ snapshots: [], answer: null });
        }),
    );
    const band = await screen.findByLabelText(STRIP_LABEL);
    const pause = within(band).getByRole("button", { name: "Pause" });

    fireEvent.click(pause);
    await waitFor(() => expect(pause).toBeDisabled());
    fireEvent.click(pause);
    expect(host.asked("set_paused")).toHaveLength(1);

    act(() => answer?.());
    await waitFor(() => expect(pause).toBeEnabled());
  });

  test("the rewind step sends its own seek", async () => {
    const { host } = mount();
    await screen.findByLabelText(STRIP_LABEL);

    fireEvent.click(within(strip()).getByRole("button", { name: "Back ten seconds" }));
    await waitFor(() =>
      expect(host.asked("seek")).toEqual([
        { type: "seek", target: { kind: "by", seconds: -10 } },
      ]),
    );
  });

  test("steps aside on the player screen, and returns on leaving it", async () => {
    mount();
    expect(await screen.findByLabelText(STRIP_LABEL)).toBeInTheDocument();

    await openCard();
    expect(screen.queryByLabelText(STRIP_LABEL)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(screen.getByLabelText(STRIP_LABEL)).toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });
});

describe("the Remote's expanded card", () => {
  test("Back closes the card without stopping, and leaves the destination underneath", async () => {
    const { host } = mount();
    await openCard();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: CARD_NAME }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(host.asked("stop_playback")).toEqual([]);
  });

  test("its six cells send the core's six Actions", async () => {
    const { host } = mount();
    const card = await openCard();

    const sequence: Array<[string, Action]> = [
      ["Previous episode", { type: "previous_episode" }],
      ["Back ten seconds", { type: "seek", target: { kind: "by", seconds: -10 } }],
      ["Pause", { type: "set_paused", paused: true }],
      ["Forward ten seconds", { type: "seek", target: { kind: "by", seconds: 10 } }],
      ["Next episode", { type: "next_episode" }],
      ["Stop", { type: "stop_playback" }],
    ];

    for (const [label] of sequence) {
      fireEvent.click(within(card).getByRole("button", { name: label }));
    }

    await waitFor(() => expect(host.actions).toEqual(sequence.map(([, action]) => action)));
  });

  describe("a Stalled Stream", () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "performance"] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** `openCard` waits on real timers; here the clock is the test's own. */
    function openCardNow() {
      fireEvent.click(
        within(strip()).getByRole("button", { name: new RegExp(STRIP_EXPAND) }),
      );
      return screen.getByRole("region", { name: CARD_NAME });
    }

    async function mountStalled() {
      const mounted = mount();
      await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
      });
      act(() => mounted.host.publish(snapshot({ stalled: true }, 3)));
      return mounted;
    }

    test("the strip says Waiting… from one continuous second, and clears when it ends", async () => {
      const { host } = await mountStalled();
      expect(within(strip()).queryByText(STALLED_STRIP_NOTE)).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(STALL_GRACE_MS - 1));
      expect(within(strip()).queryByText(STALLED_STRIP_NOTE)).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(1));
      expect(within(strip()).getByText(STALLED_STRIP_NOTE)).toBeInTheDocument();

      act(() => host.publish(snapshot({ stalled: false }, 4)));
      expect(within(strip()).queryByText(STALLED_STRIP_NOTE)).not.toBeInTheDocument();
    });

    test("the card's state note is the ring and the sentence, after the same second", async () => {
      const { host } = await mountStalled();
      const card = openCardNow();
      expect(within(card).queryByTestId("remote-player-state")).not.toBeInTheDocument();

      act(() => vi.advanceTimersByTime(STALL_GRACE_MS));
      const note = within(card).getByTestId("remote-player-state");
      expect(note).toHaveTextContent(STALLED_NOTE);
      expect(within(note).getByTestId("pending-spinner")).toBeInTheDocument();

      act(() => host.publish(snapshot({ stalled: false }, 4)));
      expect(within(card).queryByTestId("remote-player-state")).not.toBeInTheDocument();
    });

    test("a seek's brief wait draws nothing on either", async () => {
      const { host } = await mountStalled();

      act(() => vi.advanceTimersByTime(500));
      act(() => host.publish(snapshot({ stalled: false }, 4)));
      act(() => vi.advanceTimersByTime(2000));

      // The strip is withheld on the card's own screen, so it is read first.
      expect(within(strip()).queryByText(STALLED_STRIP_NOTE)).not.toBeInTheDocument();
      const card = openCardNow();
      expect(within(card).queryByTestId("remote-player-state")).not.toBeInTheDocument();
    });
  });

  test("a control the core disables sends nothing when pressed", async () => {
    const { host } = mount();
    act(() => host.publish(snapshot({ state: "opening" }, 3)));

    const band = await screen.findByLabelText(STRIP_LABEL);
    const rewind = within(band).getByRole("button", { name: "Back ten seconds" });
    expect(rewind).toBeDisabled();
    fireEvent.click(rewind);

    const card = await openCard();
    const forward = within(card).getByRole("button", { name: "Forward ten seconds" });
    expect(forward).toBeDisabled();
    fireEvent.click(forward);

    expect(host.actions).toEqual([]);
  });

  test("Stop sends stop_playback, and the Host's idle Snapshot closes the card", async () => {
    const { host } = mount();
    const card = await openCard();

    fireEvent.click(within(card).getByRole("button", { name: "Stop" }));
    await waitFor(() =>
      expect(host.asked("stop_playback")).toEqual([{ type: "stop_playback" }]),
    );

    act(() =>
      host.publish(snapshot({ state: "idle", nowPlaying: null, episode: null }, 3)),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("region", { name: CARD_NAME }),
      ).not.toBeInTheDocument(),
    );
    expect(screen.queryByLabelText(STRIP_LABEL)).not.toBeInTheDocument();
  });
});

describe("the Remote's timeline", () => {
  test("sends one seek per committed change, never one per move", async () => {
    const { host } = mount();
    const card = await openCard();
    const bar = within(card).getByLabelText("Position");

    fireEvent.change(bar, { target: { value: "420" } });
    fireEvent.change(bar, { target: { value: "480" } });
    expect(host.asked("seek")).toEqual([]);

    fireEvent.pointerUp(bar);
    await waitFor(() =>
      expect(host.asked("seek")).toEqual([
        { type: "seek", target: { kind: "to", seconds: 480 } },
      ]),
    );
  });

  test("asks the Host for the still of the bucket a pointer is on", async () => {
    const { host } = mount();
    const card = await openCard();
    const timeline = within(card).getByTestId("remote-player-timeline");
    vi.spyOn(timeline, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 20,
      width: 1000,
      height: 20,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(timeline, { clientX: 500 });
    await waitFor(() =>
      expect(host.asked("preview")).toEqual([{ type: "preview", at: 300 }]),
    );

    fireEvent.pointerLeave(timeline);
    vi.restoreAllMocks();
  });

  test("draws the still the Host answers with above the card's timeline", async () => {
    const image = "https://images.test/still.jpg";
    const { host } = mount((action) =>
      action.type === "preview"
        ? { snapshots: [], answer: { preview: { at: action.at, image } } }
        : { snapshots: [], answer: null },
    );
    const card = await openCard();
    const timeline = within(card).getByTestId("remote-player-timeline");
    vi.spyOn(timeline, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 20,
      width: 1000,
      height: 20,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(timeline, { clientX: 500 });
    const still = await screen.findByTestId("remote-player-preview-still");
    expect(still).toHaveAttribute("src", image);
    expect(host.asked("preview")).toHaveLength(1);

    fireEvent.pointerLeave(timeline);
    vi.restoreAllMocks();
  });

  test("draws the time alone when the Host has no still to give, as it has for a torrent", async () => {
    const { host } = mount((action) =>
      action.type === "preview"
        ? { snapshots: [], answer: { preview: { at: action.at, image: null } } }
        : { snapshots: [], answer: null },
    );
    const card = await openCard();
    const timeline = within(card).getByTestId("remote-player-timeline");
    vi.spyOn(timeline, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 1000,
      bottom: 20,
      width: 1000,
      height: 20,
      toJSON: () => ({}),
    });

    fireEvent.pointerMove(timeline, { clientX: 500 });
    await waitFor(() => expect(host.asked("preview")).toHaveLength(1));
    await waitFor(() =>
      expect(screen.getByTestId("remote-player-preview")).toHaveAttribute("data-pending", "false"),
    );

    expect(screen.queryByTestId("remote-player-preview-still")).toBeNull();
    expect(screen.getByTestId("remote-player-preview")).toHaveTextContent("5:00");

    fireEvent.pointerLeave(timeline);
    vi.restoreAllMocks();
  });
});

describe("the Remote's volume box", () => {
  test("sends one level per committed change, never one per move", async () => {
    const { host } = mount();
    const card = await openCard();
    const volume = within(card).getByLabelText("Volume");

    fireEvent.change(volume, { target: { value: "80" } });
    fireEvent.change(volume, { target: { value: "90" } });
    expect(host.asked("set_volume")).toEqual([]);

    fireEvent.pointerUp(volume);
    await waitFor(() =>
      expect(host.asked("set_volume")).toEqual([{ type: "set_volume", level: 90 }]),
    );
  });

  test("the mute toggle is its own Action", async () => {
    const { host } = mount();
    const card = await openCard();

    fireEvent.click(within(card).getByRole("button", { name: "Mute" }));
    await waitFor(() =>
      expect(host.asked("set_muted")).toEqual([{ type: "set_muted", muted: true }]),
    );
  });
});

const NEXT = {
  title: { type: "series", id: "tt1" },
  video: { type: "series", id: "tt1:1:3" },
  episode: { season: 1, episode: 3 },
  name: "The Third",
  still: "https://images.test/3.jpg",
};

function counting(remaining = 4): Partial<PlaybackSnapshot> {
  return {
    state: "ended",
    autoplay: { next: NEXT, phase: "countdown", remaining, duration: 5 },
  };
}

function holding(): Partial<PlaybackSnapshot> {
  return {
    state: "ended",
    autoplay: { next: NEXT, phase: "unattended_limit" },
  };
}

describe("the Remote's Still watching? hold", () => {
  test("the banner offers Keep watching only, which is the Host's next_episode", async () => {
    const { host } = mount();
    const card = await openCard();

    act(() => host.publish(snapshot(holding(), 3)));
    const banner = await within(card).findByTestId("remote-autoplay-banner");

    // No countdown and no Cancel: the hold is not a failure and nothing runs out.
    expect(within(banner).queryByTestId("remote-autoplay-digit")).not.toBeInTheDocument();
    expect(within(banner).queryByTestId("remote-autoplay-play-now")).not.toBeInTheDocument();
    expect(within(banner).queryByTestId("remote-autoplay-cancel")).not.toBeInTheDocument();
    expect(within(card).queryByTestId("remote-player-state")).not.toBeInTheDocument();

    fireEvent.click(within(banner).getByTestId("remote-autoplay-keep-watching"));
    await waitFor(() => expect(host.asked("next_episode")).toEqual([{ type: "next_episode" }]));
  });
});

describe("the Remote's Autoplay switch", () => {
  test("is on the card for an episode and takes set_autoplay with the flipped value", async () => {
    const { host } = mount();
    const card = await openCard();

    const row = within(card).getByTestId("remote-autoplay-switch");
    expect(row).toHaveAttribute("aria-checked", "true");

    fireEvent.click(row);
    await waitFor(() =>
      expect(host.asked("set_autoplay")).toEqual([
        { type: "set_autoplay", autoplay: false },
      ]),
    );
  });

  test("is absent from the card of a film", async () => {
    const { host } = mount();
    const card = await openCard();
    act(() => host.publish(snapshot({ episode: null }, 3)));

    await waitFor(() =>
      expect(within(card).queryByTestId("remote-autoplay-switch")).not.toBeInTheDocument(),
    );
  });
});

describe("the Remote's Autoplay countdown", () => {
  test("the banner stands in for the ended note, and Play now and Cancel are the Host's Actions", async () => {
    const { host } = mount();
    const card = await openCard();

    act(() => host.publish(snapshot({ state: "ended" }, 3)));
    expect(await within(card).findByTestId("remote-player-state")).toBeInTheDocument();

    act(() => host.publish(snapshot(counting(), 4)));
    const banner = await within(card).findByTestId("remote-autoplay-banner");
    expect(within(card).queryByTestId("remote-player-state")).not.toBeInTheDocument();

    fireEvent.click(within(banner).getByTestId("remote-autoplay-play-now"));
    await waitFor(() => expect(host.asked("next_episode")).toEqual([{ type: "next_episode" }]));

    fireEvent.click(within(banner).getByTestId("remote-autoplay-cancel"));
    await waitFor(() =>
      expect(host.asked("cancel_autoplay")).toEqual([{ type: "cancel_autoplay" }]),
    );
  });

  test("the banner goes when the Host clears the countdown", async () => {
    const { host } = mount();
    const card = await openCard();
    act(() => host.publish(snapshot(counting(), 3)));
    await within(card).findByTestId("remote-autoplay-banner");

    act(() => host.publish(snapshot({ state: "ended", autoplay: null }, 4)));
    await waitFor(() =>
      expect(within(card).queryByTestId("remote-autoplay-banner")).not.toBeInTheDocument(),
    );
  });
});

const SERIES: Title = {
  addon: "torrentio",
  id: "tt1",
  key: { kind: "addon", addon: "torrentio", id: "tt1" },
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
    { id: "tt1:1:2", name: "The Choice", season: 1, episode: 2, thumbnail: null, airDate: null },
    { id: "tt1:1:3", name: "The Third", season: 1, episode: 3, thumbnail: null, airDate: null },
  ],
};

const NO_STREAMS: AddonStreams[] = [{ addon: "torrentio", failure: null, streams: [] }];

/** The Host's countdown ran out: continuity found no Stream for the third episode. */
function missing(videoId = "tt1:1:3"): Partial<PlaybackSnapshot> {
  return {
    state: "ended",
    autoplay: {
      next: { ...NEXT, video: { type: "series", id: videoId } },
      phase: "no_stream",
      detail: "No Stream continues the release",
    },
  };
}

const answersTitles: Respond = (action: Action) => {
  if (action.type === "open_title") {
    return { snapshots: [], answer: { title: SERIES } };
  }
  if (action.type === "find_streams") {
    return { snapshots: [], answer: { streams: NO_STREAMS } };
  }
  return { snapshots: [], answer: null };
};

describe("the Remote's missing Stream", () => {
  test("the expanded card pushes the Streams level for the next episode once", async () => {
    const { host } = mount(answersTitles);
    await openCard();

    act(() => host.publish(snapshot(missing(), 3)));
    await waitFor(() =>
      expect(host.asked("find_streams")).toEqual([
        { type: "find_streams", video: { type: "series", id: "tt1:1:3" } },
      ]),
    );

    act(() => host.publish(snapshot(missing(), 4)));
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.asked("find_streams")).toHaveLength(1);
  });

  test("Back from the picker leaves the card without opening it again", async () => {
    const { host } = mount(answersTitles);
    await openCard();
    act(() => host.publish(snapshot(missing(), 3)));
    await waitFor(() => expect(host.asked("find_streams")).toHaveLength(1));

    fireEvent.keyDown(window, { key: "Escape" });
    await screen.findByRole("region", { name: CARD_NAME });
    act(() => host.publish(snapshot(missing(), 4)));
    await act(async () => {
      await Promise.resolve();
    });

    expect(host.asked("find_streams")).toHaveLength(1);
  });

  test("a browse screen is not interrupted: nothing is pushed, and nothing is asked", async () => {
    const { host } = mount(answersTitles);
    await screen.findByLabelText(STRIP_LABEL);

    act(() => host.publish(snapshot(missing(), 3)));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(host.asked("find_streams")).toEqual([]);
    expect(host.asked("open_title")).toEqual([]);

    // Opening the card afterwards is not "a missing Stream appearing": the
    // person already had its news on the strip.
    await openCard();
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.asked("find_streams")).toEqual([]);
  });
});
