import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeStore } from "../../core/homeStore";
import type { Intent } from "../../core/input";
import { FEATURE_ROTATION_MS } from "../../core/homeProgramme";
import { markNavigation, markPointer } from "../../core/inputModality";
import { LOOK_HINT_DWELL_MS } from "../../core/lookHint";
import type {
  Action,
  AddonManifest,
  CatalogRow,
  ContinueEntry,
  MetaPreview,
  Snapshot,
} from "../../core/wire";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { quietSession } from "../session.testing";
import { MarqueeFrame } from "./MarqueeFrame";
import { MarqueeHome } from "./MarqueeHome";
import { RehearsalEntry } from "../rehearsal/RehearsalEntry";

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
  enabled: true,
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
    imdbRating: "8.4",
    genres: ["Action", "Drama"],
    description: `${name} synopsis.`,
  };
}

const FIVE = [
  meta("tt1", "One"),
  meta("tt2", "Two"),
  meta("tt3", "Three"),
  meta("tt4", "Four"),
  meta("tt5", "Five"),
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

function answer(catalogs: CatalogRow[]): ActionOutcome {
  return { response: { snapshots: [], answer: { catalogs } }, error: null };
}

const firstPage = vi.fn(async (action: Action) => {
  if (action.type !== "browse_catalog") {
    return { response: null, error: null } satisfies ActionOutcome;
  }
  return answer([catalogRow(FIVE)]);
});

function resumeEntry(overrides: Partial<ContinueEntry> = {}): ContinueEntry {
  return {
    video: {
      id: "tt10:2:4",
      name: "Episode 4",
      season: 2,
      episode: 4,
      thumbnail: "https://images.test/tlou-still.jpg",
      airDate: null,
      description: null,
    },
    title: {
      addon: "cinemeta",
      id: "tt10",
      type: "series",
      name: "The Last of Us",
      poster: "https://images.test/tlou.jpg",
      background: "https://images.test/tlou-bg.jpg",
      logo: "https://images.test/tlou-logo.png",
    },
    position: 2400,
    duration: 3360,
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
  let registeredIntent: ((intent: Intent) => boolean) | null =
    null;

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
    setBaseIntentHandler: vi.fn((handler) => {
      registeredIntent = handler as typeof registeredIntent;
      return () => {
        if (registeredIntent === handler) {
          registeredIntent = null;
        }
      };
    }),
  };

  const rendered = render(
    <ShellContext.Provider value={value}>
      <MarqueeHome key="home" />
    </ShellContext.Provider>,
  );

  return {
    pushed,
    take,
    hint,
    choose,
    ask,
    value,
    rerenderWithSnapshot: (nextSnapshot: Snapshot | null, extra?: React.ReactNode) =>
      rendered.rerender(
        <ShellContext.Provider value={{ ...value, snapshot: nextSnapshot }}>
          {extra}
          <MarqueeHome key="home" />
        </ShellContext.Provider>,
      ),
    sendIntent: (intent: "up" | "down" | "left" | "right" | "activate" | "back") =>
      registeredIntent ? registeredIntent(intent) : false,
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

function activeSlide(): string | null {
  return screen.getByTestId("marquee-hero").getAttribute("data-active-slide");
}

function heroMode(): string | null {
  return screen.getByTestId("home-screen").getAttribute("data-hero-mode");
}

afterEach(() => {
  cleanup();
  markPointer();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Marquee Home hero rotation and actions", () => {
  it("holds the hero placeholder while Snapshot is null or Featured is pending", async () => {
    const pending = vi.fn(() => new Promise<ActionOutcome>(() => undefined));
    const { rerender } = render(
      <ShellContext.Provider
        value={{
          session: quietSession(),
          snapshot: null,
          error: null,
          destination: "home",
          chosenDestination: false,
          popover: null,
          unplayable: new Set(),
          pending: new Set(),
          markUnplayable: vi.fn(),
          choose: vi.fn(),
          push: vi.fn(() => "l1"),
          remove: vi.fn(),
          levelExists: vi.fn(() => true),
          pop: vi.fn(),
          back: vi.fn(),
          ask: pending,
          take: vi.fn(async () => null),
          hint: vi.fn(),
          home: new HomeStore(pending),
          setIntentHandler: vi.fn(),
          setBaseIntentHandler: vi.fn(() => () => {}),
        }}
      >
        <MarqueeHome />
      </ShellContext.Provider>,
    );
    expect(screen.getByTestId("marquee-hero-placeholder")).toBeInTheDocument();

    rerender(
      <ShellContext.Provider
        value={{
          session: quietSession(),
          snapshot: BASE_SNAPSHOT,
          error: null,
          destination: "home",
          chosenDestination: false,
          popover: null,
          unplayable: new Set(),
          pending: new Set(),
          markUnplayable: vi.fn(),
          choose: vi.fn(),
          push: vi.fn(() => "l1"),
          remove: vi.fn(),
          levelExists: vi.fn(() => true),
          pop: vi.fn(),
          back: vi.fn(),
          ask: pending,
          take: vi.fn(async () => null),
          hint: vi.fn(),
          home: new HomeStore(pending),
          setIntentHandler: vi.fn(),
          setBaseIntentHandler: vi.fn(() => () => {}),
        }}
      >
        <MarqueeHome />
      </ShellContext.Provider>,
    );
    await flush();
    expect(screen.getByTestId("marquee-hero-placeholder")).toBeInTheDocument();
  });

  it("seats launch focus on Watch now and rotates through 5 featured titles keeping focus", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    renderHome({ chosenDestination: false });
    await flush();

    const watchNow = screen.getByRole("button", { name: "Watch now" });
    expect(document.activeElement).toBe(watchNow);
    expect(heroMode()).toBe("rotating");
    expect(activeSlide()).toBe("tt1");

    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(activeSlide()).toBe("tt2");
    expect(document.activeElement).toBe(watchNow);

    fireEvent.click(screen.getByRole("button", { name: "Show Four" }));
    expect(activeSlide()).toBe("tt4");
    expect(screen.getByRole("button", { name: "Show Four" })).toHaveAttribute(
      "aria-current",
      "step",
    );
  });

  it("keeps the beat under reduced motion (ADR-0036 §2)", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => ({
        matches: true,
        media: "(prefers-reduced-motion: reduce)",
        addEventListener: () => {},
        removeEventListener: () => {},
      })),
    );
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    renderHome();
    await flush();

    expect(activeSlide()).toBe("tt1");
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(activeSlide()).toBe("tt2");
  });

  it("holds the beat under a pressed pointer and lets go on release", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    renderHome();
    await flush();
    const hero = screen.getByTestId("marquee-hero");
    const press = { pointerId: 1, pointerType: "mouse", button: 0, clientX: 300, clientY: 200 };

    fireEvent.pointerDown(hero, press);
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS * 2));
    expect(activeSlide(), "a hand on the hero holds it").toBe("tt1");

    fireEvent.pointerUp(hero, press);
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(activeSlide()).toBe("tt2");
  });

  it("steps on horizontal swipe across the hero", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    renderHome();
    await flush();

    const hero = screen.getByTestId("marquee-hero");
    vi.spyOn(hero, "getBoundingClientRect").mockReturnValue({
      width: 1000,
      height: 880,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 880,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect);

    fireEvent.pointerDown(hero, { pointerId: 1, pointerType: "touch", clientX: 600, clientY: 200 });
    fireEvent.pointerMove(hero, { pointerId: 1, pointerType: "touch", clientX: 250, clientY: 204 });
    fireEvent.pointerUp(hero, { pointerId: 1, pointerType: "touch", clientX: 250, clientY: 204 });

    expect(activeSlide()).toBe("tt2");
  });

  it("opens the Title on Details and resumes or opens Title on Watch now", async () => {
    const { pushed, take } = renderHome();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Details" }));
    expect(pushed[0]?.name).toBe("Title");
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "movie", id: "tt1" },
      }),
    );

    const { take: resumeTake } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [
          resumeEntry({
            title: {
              addon: "cinemeta",
              id: "tt1",
              type: "movie",
              name: "One",
              poster: null,
              background: null,
              logo: null,
            },
            video: {
              id: "tt1",
              name: null,
              season: null,
              episode: null,
              thumbnail: null,
              airDate: null,
            },
          }),
        ],
      },
    });
    await flush();

    fireEvent.click(screen.getAllByRole("button", { name: "Watch now" })[1]!);
    expect(resumeTake).toHaveBeenCalledWith({
      type: "resume",
      video: { type: "movie", id: "tt1" },
    });
  });
});

describe("Marquee Home pointer vs navigation hero mode and Up return", () => {
  it("keeps Home in rotating page layout under pointer modality even on card hover or focus", async () => {
    markPointer();
    renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
      chosenDestination: false,
    });
    await flush();

    const homeScreen = screen.getByTestId("home-screen");
    expect(homeScreen).toHaveAttribute("data-home-layout", "page");
    expect(heroMode()).toBe("rotating");

    const continueCard = screen.getByTestId("resume-tt10:2:4");
    fireEvent.pointerEnter(continueCard);
    expect(heroMode()).toBe("rotating");

    act(() => continueCard.focus());
    expect(heroMode()).toBe("rotating");
    expect(homeScreen).toHaveAttribute("data-home-layout", "page");
    expect(screen.getByRole("button", { name: "Watch now" })).toBeInTheDocument();
  });

  it("switches to following focus on Continue watching / Catalog cards in navigation mode and returns to rotating on Up from the top row", async () => {
    markNavigation();
    const { sendIntent } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
      chosenDestination: false,
    });
    await flush();

    expect(heroMode()).toBe("rotating");
    const continueCard = screen.getByTestId("resume-tt10:2:4");
    act(() => continueCard.focus());

    expect(heroMode()).toBe("following");
    expect(screen.queryByRole("button", { name: "Watch now" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "The Last of Us" })).toBeInTheDocument();

    // Moving to a lower catalog row updates following focus; Up from there does not leave rows.
    const poster = screen.getByTestId("card-cinemeta-tt3");
    act(() => poster.focus());
    expect(heroMode()).toBe("following");
    expect(screen.getByRole("heading", { name: "Three" })).toBeInTheDocument();
    expect(sendIntent("up")).toBe(false);

    // Up from the topmost focusable row returns to rotating hero and seats Watch now.
    act(() => continueCard.focus());
    let handled = false;
    act(() => {
      handled = sendIntent("up");
    });
    expect(handled).toBe(true);
    expect(heroMode()).toBe("rotating");
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Watch now" })),
    );
  });

  it("clears pendingHeroFocus when Featured disappears so re-enabling Featured does not steal focus", async () => {
    markNavigation();
    const { rerenderWithSnapshot, sendIntent } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
      chosenDestination: false,
    });
    await flush();

    const continueCard = screen.getByTestId("resume-tt10:2:4");
    act(() => continueCard.focus());
    expect(heroMode()).toBe("following");

    // Trigger Up return while Featured disappears in the same commit: Watch now
    // is absent so pendingHeroFocus must be cleared rather than held.
    act(() => {
      expect(sendIntent("up")).toBe(true);
      rerenderWithSnapshot({
        ...BASE_SNAPSHOT,
        featuredCatalog: null,
        continueWatching: [resumeEntry()],
      });
    });

    expect(screen.queryByRole("button", { name: "Watch now" })).not.toBeInTheDocument();

    // Move focus to a non-row control (e.g. the nav rail) so heroMode stays
    // "rotating" when Featured returns and Watch now mounts.
    rerenderWithSnapshot(
      {
        ...BASE_SNAPSHOT,
        featuredCatalog: null,
        continueWatching: [resumeEntry()],
      },
      <button type="button" data-testid="rail-home">Rail Home</button>,
    );
    const railHome = screen.getByTestId("rail-home");
    act(() => railHome.focus());
    expect(document.activeElement).toBe(railHome);

    // Re-enabling Featured mounts Watch now in rotating mode; the cleared
    // pendingHeroFocus must not steal focus from the rail.
    rerenderWithSnapshot(
      {
        ...BASE_SNAPSHOT,
        continueWatching: [resumeEntry()],
      },
      <button type="button" data-testid="rail-home">Rail Home</button>,
    );

    expect(screen.getByRole("button", { name: "Watch now" })).toBeInTheDocument();
    expect(heroMode()).toBe("rotating");
    expect(document.activeElement).toBe(railHome);
  });

  it("suppresses vertical reveal on Home rows and clamps scrollTop against the following viewport height", async () => {
    markNavigation();
    const home = new HomeStore(firstPage);
    let registeredIntent: ((intent: Intent) => boolean) | null =
      null;
    const value: ShellContextValue = {
      session: quietSession(),
      snapshot: { ...BASE_SNAPSHOT, continueWatching: [resumeEntry()] },
      error: null,
      destination: "home",
      chosenDestination: true,
      popover: null,
      unplayable: new Set<string>(),
      pending: new Set<string>(),
      markUnplayable: vi.fn(),
      choose: vi.fn(),
      push: vi.fn(() => "l1"),
      remove: vi.fn(),
      levelExists: vi.fn(() => true),
      pop: vi.fn(),
      back: vi.fn(),
      ask: firstPage,
      take: vi.fn(async () => null),
      hint: vi.fn(),
      home,
      setIntentHandler: vi.fn(),
      setBaseIntentHandler: vi.fn((handler) => {
        registeredIntent = handler as typeof registeredIntent;
        return () => {
          if (registeredIntent === handler) {
            registeredIntent = null;
          }
        };
      }),
    };

    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { value: 1920, configurable: true });
    Object.defineProperty(window, "innerHeight", { value: 1080, configurable: true });

    try {
      render(
        <MotionConfig reducedMotion="always">
          <ShellContext.Provider value={value}>
            <MarqueeFrame
              destination="home"
              onChooseDestination={() => {}}
              levels={[]}
              onBack={() => {}}
              onBaseIntent={(intent) => registeredIntent?.(intent) ?? false}
              screen={<MarqueeHome />}
            />
          </ShellContext.Provider>
        </MotionConfig>,
      );
      await flush();

      const homeScreen = screen.getByTestId("home-screen");
      const rowsPort = homeScreen.querySelector(".mq-home-rows") as HTMLElement;
      const catalogRow = screen.getByTestId("home-row-cinemeta/movie/top");
      const card = screen.getByTestId("card-cinemeta-tt1");

      Object.defineProperty(homeScreen, "clientHeight", { value: 1080, configurable: true });
      // Simulate mid-transition rotating clientHeight (444u) before --mq-rows-shift finishes.
      Object.defineProperty(rowsPort, "clientHeight", { value: 444, configurable: true });
      Object.defineProperty(rowsPort, "scrollHeight", { value: 840, configurable: true });
      Object.defineProperty(catalogRow, "offsetTop", { value: 367, configurable: true });
      rowsPort.getBoundingClientRect = () =>
        ({ left: 0, top: 636, right: 1920, bottom: 1080, width: 1920, height: 444, x: 0, y: 636, toJSON: () => ({}) } as DOMRect);
      card.getBoundingClientRect = () =>
        ({ left: 168, top: 1060, right: 376, bottom: 1372, width: 208, height: 312, x: 168, y: 1060, toJSON: () => ({}) } as DOMRect);

      // Move focus to the card via navigation modality: reveal() runs under data-reveal="center"
      // on MarqueeFrame, must NOT jump rowsPort.scrollTop via reveal(), and MarqueeHome's effect
      // clamps 367 against the 600u following viewport (840 - 600 = 240, not 840 - 444 = 396).
      act(() => card.focus());

      expect(rowsPort.scrollTop).toBe(240);
      expect(document.documentElement.scrollTop).toBe(0);

      // Switching back to pointer modality restores page layout and preserves the visual row position
      // (rowsScrollTop 240 + 156u hero shift = 396 at 1920x1080) without a jump.
      act(() => markPointer());
      expect(homeScreen).toHaveAttribute("data-home-layout", "page");
      expect(heroMode()).toBe("rotating");
      expect(homeScreen.scrollTop).toBe(396);
      expect(rowsPort.scrollTop).toBe(0);

      // Pressing an arrow key (entering navigation modality) while on a row card returns cleanly
      // to following mode and seeds rowsPort.scrollTop from the page scroll.
      act(() => markNavigation());
      expect(homeScreen).toHaveAttribute("data-home-layout", "navigation");
      expect(heroMode()).toBe("following");
      expect(homeScreen.scrollTop).toBe(0);
    } finally {
      Object.defineProperty(window, "innerWidth", { value: originalInnerWidth, configurable: true });
      Object.defineProperty(window, "innerHeight", { value: originalInnerHeight, configurable: true });
    }
  });
});

describe("Marquee Home Continue watching, rows, look hints and empty/error states", () => {
  it("marks addon_disabled and addon_removed entries unplayable without allowing press", async () => {
    const { pushed, take } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [
          resumeEntry({
            video: {
              id: "tt20:1:1",
              name: "Disabled",
              season: 1,
              episode: 1,
              thumbnail: null,
              airDate: null,
            },
            unplayable: { reason: "addon_disabled", addon: "cinemeta" },
          }),
          resumeEntry({
            video: {
              id: "tt21:1:1",
              name: "Removed",
              season: 1,
              episode: 1,
              thumbnail: null,
              airDate: null,
            },
            unplayable: { reason: "addon_removed", addon: "old" },
          }),
        ],
      },
    });
    await flush();

    const disabledCard = screen.getByTestId("resume-tt20:1:1");
    const removedCard = screen.getByTestId("resume-tt21:1:1");
    expect(disabledCard).toBeDisabled();
    expect(removedCard).toBeDisabled();
    expect(disabledCard).toHaveAccessibleName(/Addon disabled/);
    expect(removedCard).toHaveAccessibleName(/Addon removed/);

    fireEvent.click(disabledCard);
    fireEvent.click(removedCard);
    expect(pushed).toHaveLength(0);
    expect(take).not.toHaveBeenCalled();
  });

  it("opens Continue watching and Catalog cards via open_title or open_discovered_title", async () => {
    const { pushed, take } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [
          resumeEntry(),
          resumeEntry({
            video: {
              id: "tmdb:603:1:1",
              name: "Discovered",
              season: 1,
              episode: 1,
              thumbnail: null,
              airDate: null,
            },
            title: {
              addon: null,
              id: "tmdb:603",
              type: "series",
              name: "Discovered Show",
              poster: null,
              background: null,
              logo: null,
            },
          }),
        ],
      },
    });
    await flush();

    fireEvent.click(screen.getByTestId("resume-tt10:2:4"));
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_title",
        addon: "cinemeta",
        title: { type: "series", id: "tt10" },
      }),
    );

    // Wait for first open_title call to finish before clicking next card.
    await flush();
    fireEvent.click(screen.getByTestId("resume-tmdb:603:1:1"));
    await waitFor(() =>
      expect(take).toHaveBeenCalledWith({
        type: "open_discovered_title",
        key: { kind: "tmdb", id: 603 },
        kind: "series",
      }),
    );
    expect(pushed.length).toBeGreaterThanOrEqual(1);
  });

  it("sends look_hint after resting on a card for the dwell", async () => {
    const { hint } = renderHome();
    await flush();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    act(() => screen.getByTestId("card-cinemeta-tt1").focus());
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS));

    expect(hint).toHaveBeenCalledWith({
      type: "look_hint",
      addon: "cinemeta",
      title: { type: "movie", id: "tt1" },
    });
  });

  it("draws one card per Continue watching entry, and none from Watch progress alone", async () => {
    const card = resumeEntry();
    const other = resumeEntry({
      video: { ...card.video, id: "tt10:2:5", episode: 5 },
      position: 120,
    });
    const { rerenderWithSnapshot } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [card],
        watchProgress: [card, other],
      },
    });
    await flush();

    expect(screen.getByTestId("resume-tt10:2:4")).toBeInTheDocument();
    expect(screen.queryByTestId("resume-tt10:2:5")).not.toBeInTheDocument();

    rerenderWithSnapshot({ ...BASE_SNAPSHOT, continueWatching: [], watchProgress: [card] });
    expect(screen.queryByTestId("home-continue")).not.toBeInTheDocument();
  });

  it("names a Discovered card's look hint with no Addon", async () => {
    const { hint } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        continueWatching: [
          resumeEntry({ title: { ...resumeEntry().title, addon: null, id: "tmdb:603" } }),
        ],
      },
    });
    await flush();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });

    act(() => screen.getByTestId("resume-tt10:2:4").focus());
    act(() => vi.advanceTimersByTime(LOOK_HINT_DWELL_MS));

    expect(hint).toHaveBeenCalledWith({
      type: "look_hint",
      addon: null,
      title: { type: "series", id: "tmdb:603" },
    });
  });

  it("says when an Addon answered a row with nothing, and draws no empty state beside it", async () => {
    renderHome({
      ask: async () => ({
        response: { snapshots: [], answer: { catalogs: [catalogRow([], 0)] } },
        error: null,
      }),
    });
    await flush();

    expect(
      await screen.findByText("The Addon answered with no Titles in this Catalog."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("home-empty")).not.toBeInTheDocument();
  });

  it("reports row failures inline and offers Addons when Home has no catalogs", async () => {
    const failingAsk = vi.fn(async () => ({
      response: null,
      error: { kind: "fetch", detail: "timeout" } as const,
    }));
    renderHome({ ask: failingAsk });
    await flush();

    expect(await screen.findByRole("alert")).toHaveTextContent("could not fetch");

    const { choose } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, addons: [], featuredCatalog: null },
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "Open Addons" }));
    expect(choose).toHaveBeenCalledWith("addons");
  });
});

describe("the rehearsal entry", () => {
  it("mounts Home from the preview Host Snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network in test");
      }),
    );

    const view = render(<RehearsalEntry />);
    expect(await screen.findByTestId("home-screen")).toBeInTheDocument();
    view.unmount();
  });
});
