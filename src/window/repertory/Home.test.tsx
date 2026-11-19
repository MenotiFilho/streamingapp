import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  Action,
  AddonManifest,
  CatalogRow,
  ContinueEntry,
  MetaPreview,
  Snapshot,
} from "../../core/wire";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { HomeStore } from "../../core/homeStore";
import { LOOK_HINT_DWELL_MS } from "../../core/lookHint";
import { FEATURE_ROTATION_MS } from "./homeProgramme";
import { RepertoryHome } from "./RepertoryHome";
import { quietSession } from "../session.testing";

const CATALOG = {
  type: "movie",
  id: "top",
  name: "Popular",
  extra: [{ name: "skip", isRequired: false, options: [], optionsLimit: 0 }],
};

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [CATALOG],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const BASE_SNAPSHOT: Snapshot = {
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
  addons: [CINEMETA],
  featuredCatalog: { addon: "cinemeta", catalog: { type: "movie", id: "top" } },
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
  continueWatching: [],
  watchProgress: [],
  devices: [],
  pairingCode: "----",
  address: null,
};

function meta(id: string, name: string): MetaPreview {
  return {
    id,
    type: "movie",
    name,
    poster: `https://images.test/${id}.jpg`,
    posterShape: "poster",
    background: `https://images.test/${id}-backdrop.jpg`,
    releaseInfo: "2026",
    imdbRating: "8.1",
    genres: ["Drama"],
    description: `${name} is screening tonight.`,
  };
}

const FOUR = [
  meta("tt1", "One"),
  meta("tt2", "Two"),
  meta("tt3", "Three"),
  meta("tt4", "Four"),
];

function catalogRow(metas: MetaPreview[], sent = metas.length): CatalogRow {
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

function browse(action: Action): action is Extract<Action, { type: "browse_catalog" }> {
  return action.type === "browse_catalog";
}

function answer(catalogs: CatalogRow[]): ActionOutcome {
  return { response: { snapshots: [], answer: { catalogs } }, error: null };
}

const firstPage = vi.fn(async (action: Action) => {
  if (!browse(action)) {
    return { response: null, error: null } satisfies ActionOutcome;
  }
  return answer([catalogRow(FOUR)]);
});

/** One page that is already the whole row, so opening its grid asks for no more. */
const completePage = vi.fn(async (action: Action) => {
  if (!browse(action)) {
    return { response: null, error: null } satisfies ActionOutcome;
  }
  return answer([catalogRow(FOUR, 0)]);
});

function resumeEntry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
    title: {
      addon: "cinemeta",
      id: "tt1",
      type: "series",
      name: "One",
      poster: "https://images.test/one.jpg",
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

function renderHome({
  snapshot = BASE_SNAPSHOT,
  ask = firstPage,
  chosenDestination = true,
}: {
  snapshot?: Snapshot | null;
  ask?: (action: Action) => Promise<ActionOutcome>;
  chosenDestination?: boolean;
} = {}) {
  const pushed: NewShellLevel[] = [];
  const take = vi.fn(async (_action: Action) => null);
  const hint = vi.fn();
  const choose = vi.fn();
  const value: ShellContextValue = {
    session: quietSession(),
    snapshot,
    error: null,
    destination: "home",
    chosenDestination,
    popover: null,
    unplayable: new Set<string>(),
    pending: new Set<string>(),
    markUnplayable: vi.fn(),
    choose,
    push: vi.fn((level: NewShellLevel) => {
      pushed.push(level);
      return `level-${pushed.length}`;
    }),
    remove: vi.fn(),
    levelExists: vi.fn(() => true),
    pop: vi.fn(),
    back: vi.fn(),
    ask,
    take,
    hint,
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
    setBaseIntentHandler: vi.fn(() => () => {}),
  };

  render(
    <ShellContext.Provider value={value}>
      <RepertoryHome />
    </ShellContext.Provider>,
  );

  return { pushed, take, hint, choose, ask, value };
}

/** Draw a level the Home harness recorded, as the frame would above the base. */
function renderLevel(level: NewShellLevel, value: ShellContextValue) {
  render(<ShellContext.Provider value={value}>{level.payload.render()}</ShellContext.Provider>);
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function activeSlide(): string | null {
  return screen.getByTestId("repertory-feature").getAttribute("data-active-slide");
}

/**
 * jsdom has no layout, and the gesture's distance is a share of the frame's
 * width: the test hands the screen the width the window would give it.
 */
function withWidth(element: HTMLElement, width: number) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    width,
    height: (width * 9) / 16,
    top: 0,
    right: width,
    bottom: (width * 9) / 16,
    left: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function baseIntent(value: ShellContextValue): (intent: "left" | "right") => boolean {
  const handler = vi
    .mocked(value.setBaseIntentHandler)
    .mock.calls.map(([held]) => held)
    .filter((held): held is NonNullable<typeof held> => held !== null)
    .at(-1);
  if (!handler) {
    throw new Error("the feature did not register a base intent handler");
  }
  return handler as (intent: "left" | "right") => boolean;
}

function onlyIntervals() {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
}

function reduceMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Home's feature presentation", () => {
  it("keeps the feature's frame while the Featured catalog is still answering", async () => {
    const pending = vi.fn(
      () => new Promise<ActionOutcome>(() => undefined),
    ) as (action: Action) => Promise<ActionOutcome>;
    renderHome({ ask: pending });
    await flush();

    expect(screen.getByTestId("repertory-feature-placeholder")).toBeInTheDocument();
  });

  it("holds the feature's frame while the Host has not sent a Snapshot yet", async () => {
    renderHome({ snapshot: null, chosenDestination: false });
    await flush();

    expect(screen.getByTestId("repertory-feature-placeholder")).toBeInTheDocument();
  });

  it("rotates on its 15s beat and holds while the action is focused", async () => {
    onlyIntervals();
    renderHome();
    await flush();

    expect(activeSlide()).toBe("tt1");

    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(activeSlide()).toBe("tt2");

    const action = screen.getByRole("button", { name: /Open the Title/ });
    act(() => action.focus());

    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(activeSlide(), "focus holds the feature").toBe("tt2");

    act(() => action.blur());
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(activeSlide()).toBe("tt3");
  });

  it("does not hold the beat for the focus the screen places at launch", async () => {
    onlyIntervals();
    renderHome({ chosenDestination: false });
    await flush();

    const action = screen.getByRole("button", { name: /Open the Title/ });
    expect(document.activeElement, "the screen seats the feature on launch").toBe(action);

    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(
      activeSlide(),
      "the screen's own focus is not a hand on the programme, so the beat starts",
    ).toBe("tt2");

    // A person's focus is still a hold: the ADR's pause is about a hand, not
    // about where the screen put the seat.
    act(() => action.blur());
    act(() => action.focus());
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS * 2));
    expect(activeSlide(), "a person's focus holds the programme").toBe("tt2");
  });

  it("steps with Left and Right through the base intent without losing focus", async () => {
    onlyIntervals();
    const { value } = renderHome();
    await flush();

    const action = screen.getByRole("button", { name: /Open the Title/ });
    act(() => action.focus());
    await flush();

    act(() => expect(baseIntent(value)("right"), "a step is the feature's").toBe(true));
    expect(activeSlide()).toBe("tt2");
    expect(document.activeElement).toBe(action);

    await flush();
    act(() => expect(baseIntent(value)("left")).toBe(true));
    expect(activeSlide()).toBe("tt1");
    expect(document.activeElement).toBe(action);
  });

  it("leaves Left at the first slide to the frame and holds Right at the last", async () => {
    onlyIntervals();
    const { value } = renderHome();
    await flush();

    const action = screen.getByRole("button", { name: /Open the Title/ });
    act(() => action.focus());
    await flush();

    expect(
      baseIntent(value)("left"),
      "Left at the first slide is not the feature's: the engine crosses to the spine",
    ).toBe(false);
    expect(activeSlide()).toBe("tt1");

    for (let step = 0; step < 3; step += 1) {
      act(() => baseIntent(value)("right"));
      await flush();
    }
    expect(activeSlide()).toBe("tt4");

    expect(baseIntent(value)("right"), "Right at the last slide stays").toBe(true);
    expect(activeSlide()).toBe("tt4");
  });

  it("keeps the beat under reduced motion", async () => {
    reduceMotion();
    onlyIntervals();
    renderHome();
    await flush();

    expect(activeSlide()).toBe("tt1");
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(
      activeSlide(),
      "ADR-0036 §2 supersedes the design record's 'reduced motion stops it'",
    ).toBe("tt2");
  });

  it("restarts the stepped-to slide's time when focus lets go", async () => {
    onlyIntervals();
    const { value } = renderHome();
    await flush();

    const action = screen.getByRole("button", { name: /Open the Title/ });
    act(() => action.focus());
    await flush();
    act(() => vi.advanceTimersByTime(12_000));

    act(() => expect(baseIntent(value)("right")).toBe(true));
    expect(activeSlide()).toBe("tt2");

    act(() => action.blur());
    act(() => vi.advanceTimersByTime(12_000));
    expect(activeSlide(), "the press restarted Two's time").toBe("tt2");
    act(() => vi.advanceTimersByTime(12_000));
    expect(activeSlide()).toBe("tt3");
  });

  it("jumps to the tick a person presses and restarts that item's time", async () => {
    onlyIntervals();
    renderHome();
    await flush();

    act(() => vi.advanceTimersByTime(12_000));
    expect(activeSlide()).toBe("tt1");

    fireEvent.click(screen.getByRole("button", { name: "Show Three" }));
    expect(activeSlide()).toBe("tt3");
    expect(screen.getByRole("button", { name: "Show Three" })).toHaveAttribute(
      "aria-current",
      "step",
    );

    act(() => vi.advanceTimersByTime(12_000));
    expect(activeSlide(), "the jump restarted Three's time").toBe("tt3");

    act(() => vi.advanceTimersByTime(12_000));
    expect(activeSlide()).toBe("tt4");
  });

  it("steps with a horizontal drag and does not open the Title", async () => {
    onlyIntervals();
    const { pushed } = renderHome();
    await flush();

    const frame = screen.getByRole("button", { name: /Open the Title/ });
    withWidth(frame, 400);
    fireEvent.pointerDown(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 320,
      clientY: 200,
    });
    fireEvent.pointerMove(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 204,
    });
    fireEvent.pointerUp(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 204,
    });
    fireEvent.click(frame, { detail: 1 });

    await waitFor(() => expect(activeSlide(), "120 of 400 crosses the share").toBe("tt2"));
    expect(pushed, "the drag's click is not a press on the feature").toHaveLength(0);
  });

  it("snaps a drag back when it comes back under the share", async () => {
    onlyIntervals();
    renderHome();
    await flush();

    const frame = screen.getByRole("button", { name: /Open the Title/ });
    withWidth(frame, 400);
    fireEvent.pointerDown(frame, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 320,
      clientY: 200,
    });
    fireEvent.pointerMove(frame, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 200,
      clientY: 204,
    });
    fireEvent.pointerMove(frame, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 290,
      clientY: 204,
    });
    fireEvent.pointerUp(frame, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 290,
      clientY: 204,
    });

    await waitFor(() => expect(activeSlide(), "30 of 400 is under the share").toBe("tt1"));
  });

  it("does not leave the programme held by a press that focused the frame", async () => {
    onlyIntervals();
    renderHome();
    await flush();

    const frame = screen.getByRole("button", { name: /Open the Title/ });
    // A mouse press focuses the frame before the pointer events arrive.
    act(() => frame.focus());
    fireEvent.pointerDown(frame, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 300,
      clientY: 200,
    });
    fireEvent.pointerUp(frame, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 300,
      clientY: 200,
    });

    expect(document.activeElement, "the press focused the frame").toBe(frame);
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(
      activeSlide(),
      "the pointer's release let go even though focus stayed",
    ).toBe("tt2");
  });

  it("wraps a drag back from the first slide to the last", async () => {
    onlyIntervals();
    renderHome();
    await flush();

    const frame = screen.getByRole("button", { name: /Open the Title/ });
    withWidth(frame, 400);
    fireEvent.pointerDown(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 300,
      clientY: 198,
    });
    fireEvent.pointerUp(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 300,
      clientY: 198,
    });
    fireEvent.click(frame, { detail: 1 });

    await waitFor(() => expect(activeSlide(), "a rightward drag wraps to the last").toBe("tt4"));
  });

  it("lets the next keyboard Enter open the Title after a drag synthesised no click", async () => {
    onlyIntervals();
    const { pushed } = renderHome();
    await flush();

    const frame = screen.getByRole("button", { name: /Open the Title/ });
    fireEvent.pointerDown(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 320,
      clientY: 200,
    });
    fireEvent.pointerMove(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 240,
      clientY: 204,
    });
    fireEvent.pointerUp(frame, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 240,
      clientY: 204,
    });

    // The browser synthesises no click after this gesture, so the step flag is
    // still set. A keyboard activation carries detail 0 and must not be eaten.
    fireEvent.click(frame, { detail: 0 });

    expect(pushed[0]?.name).toBe("Title");
  });

  it("opens the feature's Title through the Featured catalog's Addon", async () => {
    const { pushed, take } = renderHome();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /Open the Title/ }));

    expect(pushed[0]?.name).toBe("Title");
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "movie", id: "tt1" },
      }),
    );
  });

  it("heads the screen with one programme line, not a second heading", async () => {
    renderHome();
    await flush();

    expect(screen.getByTestId("home-programme-line")).toHaveTextContent("Home");
    expect(screen.getAllByRole("heading", { name: "Home" })).toHaveLength(1);
  });
});

describe("Home's Continue watching", () => {
  it("draws the kit card and opens the Title the Host recorded", async () => {
    const { take } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
    });
    await flush();

    const card = screen.getByTestId("resume-tt1:1:1");
    expect(card).toHaveTextContent("5:00 left");
    fireEvent.click(card);

    expect(take).toHaveBeenCalledWith({
      type: "open_title",
      addon: "cinemeta",
      title: { type: "series", id: "tt1" },
    });
  });

  it("opens a card whose stub names no Addon through TMDB", async () => {
    const { take } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [
          resumeEntry({
            video: { id: "tmdb:603:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null, airDate: null },
            title: {
              addon: null,
              id: "tmdb:603",
              type: "series",
              name: "The Matrix",
              poster: null,
              background: null,
            },
          }),
        ],
      },
    });
    await flush();

    fireEvent.click(screen.getByTestId("resume-tmdb:603:1:1"));

    expect(take).toHaveBeenCalledWith({
      type: "open_discovered_title",
      key: { kind: "tmdb", id: 603 },
      kind: "series",
    });
  });

  it("marks an entry whose Addon is gone and makes it unpressable", async () => {
    const { take } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [
          resumeEntry({ unplayable: { reason: "addon_removed", addon: "cinemeta" } }),
        ],
      },
    });
    await flush();

    const card = screen.getByTestId("resume-tt1:1:1");
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(take).not.toHaveBeenCalled();
  });

  it("draws one card per Continue watching entry, not one per Video's progress", async () => {
    const card = resumeEntry();
    renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [card],
        watchProgress: [
          card,
          resumeEntry({
            video: { ...card.video, id: "tt1:1:2", name: "Second", episode: 2 },
            position: 120,
          }),
        ],
      },
    });
    await flush();

    expect(screen.getByTestId("resume-tt1:1:1")).toBeInTheDocument();
    expect(
      screen.queryByTestId("resume-tt1:1:2"),
      "a per-Video Watch progress entry is not a card of its own",
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("resume-tt1:1:2-progress")).not.toBeInTheDocument();
  });

  it("draws no Continue watching row from per-Video Watch progress alone", async () => {
    renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [], watchProgress: [resumeEntry()] },
    });
    await flush();

    expect(screen.queryByTestId("home-continue")).not.toBeInTheDocument();
  });

  it("opens the whole row and opens the Title from a card there", async () => {
    const { pushed, take, value } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More Continue watching" }));

    expect(pushed[0]?.name).toBe("All of Continue watching");
    renderLevel(pushed[0]!, value);

    const card = await screen.findByTestId("grid-resume-tt1:1:1");
    fireEvent.click(card);

    expect(take).toHaveBeenCalledWith({
      type: "open_title",
      addon: "cinemeta",
      title: { type: "series", id: "tt1" },
    });
  });
});

describe("Home's look hints", () => {
  function cardTimers() {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  }

  it("reads a Title ahead once a card has been focused for the dwell", async () => {
    const { hint } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
    });
    await flush();
    cardTimers();

    const card = screen.getByTestId("resume-tt1:1:1");
    act(() => card.focus());
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS - 1));
    expect(hint, "a card focused only in passing is not read ahead").not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(1));
    expect(hint).toHaveBeenCalledWith({
      type: "look_hint",
      addon: "cinemeta",
      title: { type: "series", id: "tt1" },
    });
  });

  it("does not read ahead a card focus has already left", async () => {
    const { hint } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
    });
    await flush();
    cardTimers();

    const card = screen.getByTestId("resume-tt1:1:1");
    act(() => card.focus());
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS - 1));
    act(() => card.blur());
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS));

    expect(hint).not.toHaveBeenCalled();
  });

  it("reads ahead a poster the pointer rests on, and not one it passes over", async () => {
    const { hint } = renderHome();
    await flush();
    cardTimers();

    const card = screen.getByTestId("card-cinemeta-tt1");
    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS - 1));
    fireEvent.pointerLeave(card);
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS));
    expect(hint, "the pointer did not rest").not.toHaveBeenCalled();

    fireEvent.pointerEnter(card);
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS));
    expect(hint).toHaveBeenCalledWith({
      type: "look_hint",
      addon: "cinemeta",
      title: { type: "movie", id: "tt1" },
    });
  });

  it("names a Discovered card's Title with no Addon", async () => {
    const { hint } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [
          resumeEntry({
            title: {
              addon: null,
              id: "tmdb:603",
              type: "series",
              name: "The Matrix",
              poster: null,
              background: null,
            },
          }),
        ],
      },
    });
    await flush();
    cardTimers();

    act(() => screen.getByTestId("resume-tt1:1:1").focus());
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS));

    expect(hint).toHaveBeenCalledWith({
      type: "look_hint",
      addon: null,
      title: { type: "series", id: "tmdb:603" },
    });
  });
});

describe("Home's catalog rows", () => {
  it("ends the rail with a More card and no header action", async () => {
    renderHome();
    await flush();

    expect(screen.queryByRole("button", { name: "More" })).not.toBeInTheDocument();
    const more = screen.getByRole("button", { name: "More Popular" });
    expect(more).toBeInTheDocument();
  });

  it("opens the whole row from the More card and pages it to the end", async () => {
    const ask = vi.fn(async (action: Action) => {
      if (!browse(action)) {
        return { response: null, error: null } satisfies ActionOutcome;
      }
      const skip = action.extra.find((extra) => extra.name === "skip")?.value;
      return answer([skip ? catalogRow([meta("tt5", "Five")], 1) : catalogRow(FOUR)]);
    });
    const { pushed, value } = renderHome({ ask });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More Popular" }));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("All of Popular");

    renderLevel(pushed[0]!, value);
    expect(await screen.findByRole("region", { name: "All of Popular" })).toBeInTheDocument();
    expect(screen.getByTestId("grid-card-cinemeta-tt1")).toBeInTheDocument();

    await waitFor(() =>
      expect(
        ask.mock.calls
          .map(([action]) => action)
          .some(
            (action) =>
              action.type === "browse_catalog" &&
              action.extra.some((extra) => extra.name === "skip" && extra.value === "4"),
          ),
      ).toBe(true),
    );
    await waitFor(() => expect(value.home.getSnapshot().rows[0]?.done).toBe(true));
  });

  it("opens a card in the whole row through the same Title opener", async () => {
    const { pushed, take, value } = renderHome({ ask: completePage });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More Popular" }));
    renderLevel(pushed[0]!, value);

    fireEvent.click(await screen.findByTestId("grid-card-cinemeta-tt1"));

    expect(pushed[1]?.name).toBe("Title");
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "movie", id: "tt1" },
      }),
    );
  });

  it("the whole row's Back is the shell's pop", async () => {
    const { pushed, value } = renderHome({ ask: completePage });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More Popular" }));
    renderLevel(pushed[0]!, value);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(value.pop).toHaveBeenCalledTimes(1);
  });

  it("draws an Addon's failure inline and keeps the row's head", async () => {
    const ask = vi.fn(async () => ({
      response: null,
      error: { kind: "fetch", detail: "timeout" } as const,
    }));
    renderHome({ ask });
    await flush();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("could not fetch");
    expect(screen.getByRole("heading", { name: "Popular" })).toBeInTheDocument();
  });

  it("says when an Addon answered a section with nothing", async () => {
    const ask = vi.fn(async () => answer([catalogRow([], 0)]));
    renderHome({ ask });
    await flush();

    expect(
      screen.getByText("The Addon answered with no Titles in this section."),
    ).toBeInTheDocument();
  });

  it("opens a poster's Title through the Addon that answered the row", async () => {
    const { pushed, take } = renderHome();
    await flush();

    fireEvent.click(screen.getByTestId("card-cinemeta-tt1"));

    expect(pushed[0]?.name).toBe("Title");
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "movie", id: "tt1" },
      }),
    );
  });
});

describe("Home's empty programme", () => {
  it("says nothing is screening and offers the one way out", async () => {
    const { choose } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, addons: [], featuredCatalog: null },
    });
    await flush();

    expect(screen.getByText("Nothing is screening tonight.")).toBeInTheDocument();
    expect(screen.getByText("Add an Addon to open the programme.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open Addons" }));
    expect(choose).toHaveBeenCalledWith("addons");
  });

  it("does not draw the empty state while a programme exists", async () => {
    renderHome();
    await flush();

    expect(screen.queryByTestId("home-empty")).not.toBeInTheDocument();
  });
});
