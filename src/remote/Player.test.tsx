import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { pictureNote } from "../core/playback";
import type { HostLink } from "../core/link";
import type { Action, PlaybackSnapshot, ResumeEntry, Snapshot } from "../core/wire";
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
