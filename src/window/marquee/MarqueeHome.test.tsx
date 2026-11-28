import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HomeStore } from "../../core/homeStore";
import { FEATURE_ROTATION_MS } from "../../core/homeProgramme";
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
import { MarqueeHome } from "./MarqueeHome";
import { MarqueeRehearsalEntry } from "./MarqueeRehearsalEntry";

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
  let registeredIntent: ((intent: "up" | "down" | "left" | "right" | "activate" | "back") => boolean) | null =
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

  render(
    <ShellContext.Provider value={value}>
      <MarqueeHome />
    </ShellContext.Provider>,
  );

  return {
    pushed,
    take,
    hint,
    choose,
    ask,
    value,
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

describe("Marquee Home following focus and Up return", () => {
  it("switches to following focus on Continue watching / Catalog cards and returns to rotating on Up from the top row", async () => {
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

describe("Marquee rehearsal entry", () => {
  it("mounts Home from the preview Host Snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no network in test");
      }),
    );

    const view = render(<MarqueeRehearsalEntry />);
    expect(await screen.findByTestId("home-screen")).toBeInTheDocument();
    view.unmount();
  });
});
