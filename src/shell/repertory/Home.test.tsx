import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  type Action,
  type AddonManifest,
  type CatalogRow,
  type MetaPreview,
  type ResumeEntry,
  type Snapshot,
} from "../../host-client";
import { ShellContext, type ActionOutcome, type NewShellLevel, type ShellContextValue } from "../context";
import { HomeStore } from "../homeStore";
import { FEATURE_ROTATION_MS } from "./homeProgramme";
import { RepertoryHome } from "./RepertoryHome";

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
    crop: null,
    aspect: null,
    resolution: null,
    statistics: null,
  },
  preferences: {
    subtitleLanguage: null,
    subtitleColor: "#FFFFFF",
    subtitleScale: 1,
    streamBuffer: { seconds: 300, megabytes: 512 },
  },
  addons: [CINEMETA],
  featuredCatalog: { addon: "cinemeta", catalog: { type: "movie", id: "top" } },
  protection: { backend: "file", tmdbHeld: false, stremioHeld: false },
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

function resumeEntry(overrides: Partial<ResumeEntry> = {}): ResumeEntry {
  return {
    video: { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null },
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
    unplayable: null,
    ...overrides,
  };
}

function renderHome({
  snapshot = BASE_SNAPSHOT,
  ask = firstPage,
  chosenDestination = true,
}: {
  snapshot?: Snapshot;
  ask?: (action: Action) => Promise<ActionOutcome>;
  chosenDestination?: boolean;
} = {}) {
  const pushed: NewShellLevel[] = [];
  const take = vi.fn(async (_action: Action) => null);
  const choose = vi.fn();
  const value: ShellContextValue = {
    presentation: "repertory",
    snapshot,
    error: null,
    destination: "home",
    chosenDestination,
    popover: null,
    unplayable: new Set<string>(),
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
    home: new HomeStore(ask),
    setIntentHandler: vi.fn(),
  };

  render(
    <ShellContext.Provider value={value}>
      <RepertoryHome />
    </ShellContext.Provider>,
  );

  return { pushed, take, choose, ask };
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
  it("rotates on its 24s beat and holds while the action is focused", async () => {
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

  it("steps with Left and Right from the action without losing focus", async () => {
    onlyIntervals();
    renderHome();
    await flush();

    const action = screen.getByRole("button", { name: /Open the Title/ });
    act(() => action.focus());

    fireEvent.keyDown(action, { key: "ArrowRight" });
    expect(activeSlide()).toBe("tt2");
    expect(document.activeElement).toBe(action);

    fireEvent.keyDown(action, { key: "ArrowLeft" });
    expect(activeSlide()).toBe("tt1");
    expect(document.activeElement).toBe(action);
  });

  it("stops the beat under reduced motion", async () => {
    reduceMotion();
    onlyIntervals();
    renderHome();
    await flush();

    expect(activeSlide()).toBe("tt1");
    act(() => vi.advanceTimersByTime(FEATURE_ROTATION_MS));
    expect(activeSlide()).toBe("tt1");
  });

  it("opens the prototype Program note for the feature until #155", async () => {
    const { pushed } = renderHome();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: /Open the Title/ }));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Program note");
  });

  it("heads the screen with one programme line, not a second heading", async () => {
    renderHome();
    await flush();

    expect(screen.getByTestId("home-programme-line")).toHaveTextContent("Home");
    expect(screen.getAllByRole("heading", { name: "Home" })).toHaveLength(1);
  });
});

describe("Home's Continue watching", () => {
  it("draws the kit card and resumes the Video the Host recorded", async () => {
    const { take } = renderHome({
      snapshot: { ...BASE_SNAPSHOT, watchProgress: [resumeEntry()] },
    });
    await flush();

    const card = screen.getByTestId("resume-tt1:1:1");
    expect(card).toHaveTextContent("5:00 left");
    fireEvent.click(card);

    expect(take).toHaveBeenCalledWith({
      type: "resume",
      video: { type: "series", id: "tt1:1:1" },
    });
  });

  it("marks an entry whose Addon is gone and makes it unpressable", async () => {
    const { take } = renderHome({
      snapshot: {
        ...BASE_SNAPSHOT,
        watchProgress: [
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
});

describe("Home's catalog rows", () => {
  it("pages a row on with the Host's skip value", async () => {
    const ask = vi.fn(async (action: Action) => {
      if (!browse(action)) {
        return { response: null, error: null } satisfies ActionOutcome;
      }
      const skip = action.extra.find((extra) => extra.name === "skip")?.value;
      return answer([skip ? catalogRow([meta("tt5", "Five")], 1) : catalogRow(FOUR)]);
    });
    renderHome({ ask });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More" }));

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

  it("opens a poster through the prototype Program note", async () => {
    const { pushed } = renderHome();
    await flush();

    fireEvent.click(screen.getByTestId("card-cinemeta-tt1"));

    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.name).toBe("Program note");
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
