import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { explain, type ActionError } from "../core/errors";
import type { Level } from "../core/navigation";
import { Session } from "../core/session";
import {
  SETTINGS_CATEGORIES,
  settingsLevelId,
} from "../core/settingsRegister";
import type {
  Action,
  AddonCatalog,
  AddonManifest,
  CatalogRow,
  ContinueEntry,
  MetaPreview,
  Response,
  Snapshot,
  Title,
  Video,
} from "../core/wire";
import { RemoteApp } from "./RemoteApp";
import { FakeHost } from "./fakeHost.testing";
import { ISSUED_TOKEN, NOTHING, PHONE, fakeLink } from "./fakeSocket.testing";
import {
  heldTitle,
  levelTitle,
  RemoteLevel,
  titleLevel,
  titleLevelOf,
  type RemotePayload,
} from "./levels";
import { playerSheetLevel } from "./playerSheets";
import { CARD_NAME, playerLevel } from "./playerScreen";
import { settingsLevel } from "./settingsScreen";

/**
 * The one level B2 pushes (ADR-0035 §1).
 *
 * A press on a card is a decision about the stack, not about the drawing: the
 * level's name, kind and payload are the shape B6 fills in. The placeholder is
 * read for the one thing it must know — which Title it is — and the app path
 * proves the room draws it and Back takes it away. The payload carries an Addon
 * where an Addon answered, and `null` where TMDB named the Title before any
 * Addon did (#207).
 */

const RESUME: ContinueEntry = {
  video: { id: "tt1:1:1", name: "Pilot", season: 1, episode: 1, thumbnail: null },
  title: {
    addon: "cinemeta",
    id: "tt1",
    type: "series",
    name: "One",
    poster: null,
    background: null,
  },
  position: 300,
  duration: 600,
  watched: false,
  unplayable: null,
};

const WITH_PROGRESS: Snapshot = { ...NOTHING, continueWatching: [RESUME] };

describe("the Remote's Title level", () => {
  test("a press carries the card's identity in the stack's own shape", () => {
    expect(titleLevel({ addon: "cinemeta", id: "tt1", type: "series", name: "One" })).toEqual({
      name: "Title",
      kind: "overlay",
      payload: {
        kind: "title",
        title: { addon: "cinemeta", id: "tt1", type: "series", name: "One" },
        answer: null,
      },
    });
  });

  test("a card's identity becomes the level's payload, with the Addon that answered", () => {
    expect(
      titleLevelOf("cinemeta", { id: "tt1", type: "movie", name: "One" }),
    ).toEqual(
      titleLevel({ addon: "cinemeta", id: "tt1", type: "movie", name: "One" }),
    );
    expect(
      titleLevelOf(null, { id: "tmdb:603", type: "movie", name: "The Matrix" }).payload,
    ).toEqual({
      kind: "title",
      title: {
        addon: null,
        id: "tmdb:603",
        type: "movie",
        name: "The Matrix",
      },
      answer: null,
    });
  });

  test("a Discovered Title's level names no Addon, because TMDB named it first", () => {
    expect(
      titleLevel({ addon: null, id: "tmdb:603", type: "movie", name: "The Matrix" }),
    ).toEqual({
      name: "Title",
      kind: "overlay",
      payload: {
        kind: "title",
        title: {
          addon: null,
          id: "tmdb:603",
          type: "movie",
          name: "The Matrix",
        },
        answer: null,
      },
    });
  });

  test("a Continue watching press opens the level, and Back closes it", async () => {
    const { host, link, release } = fakeLink(
      { snapshot: WITH_PROGRESS, known: { device: PHONE, token: ISSUED_TOKEN } },
      ISSUED_TOKEN,
    );
    await host.connect();
    const view = render(<RemoteApp link={link} />);
    try {
      fireEvent.click(await screen.findByTestId("resume-tt1:1:1"));
      expect(await screen.findByRole("heading", { name: "One" })).toBeInTheDocument();

      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByRole("heading", { name: "One" })).not.toBeInTheDocument(),
      );
      expect(link.state().kind).toBe("ready");
      expect(screen.getByRole("button", { name: "Home" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    } finally {
      view.unmount();
      release();
    }
  });
});

const HELD_TITLE: Title = {
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
  videos: [],
};

const HELD_VIDEO: Video = {
  id: "tt1:1:1",
  name: "Pilot",
  season: 1,
  episode: 1,
  thumbnail: null,
};

/**
 * The Title a stack already holds (#214).
 *
 * The player level carries it as data so the Episodes plate lists the seasons
 * this client has answered rather than asking the Host for a Title again. The
 * nearest level that has one wins, from the top down, and a player pushed with
 * nothing is still the card of the Streams level under it.
 */
describe("the Title a level stack holds", () => {
  test("the nearest answered Title travels into the player and its sheet", () => {
    const answered: Level<RemotePayload> = {
      id: "level-1",
      name: "Title",
      kind: "overlay",
      payload: {
        kind: "title",
        title: { addon: "cinemeta", id: "tt1", type: "series", name: "One" },
        answer: HELD_TITLE,
      },
    };
    const streams: Level<RemotePayload> = {
      id: "level-2",
      name: "Streams",
      kind: "overlay",
      payload: { kind: "streams", title: HELD_TITLE, video: HELD_VIDEO },
    };
    const card: Level<RemotePayload> = { ...playerLevel(), id: "player" };

    expect(heldTitle([])).toBeNull();
    expect(heldTitle([answered])).toBe(HELD_TITLE);
    expect(heldTitle([answered, streams])).toBe(HELD_TITLE);
    expect(heldTitle([streams, card])).toBe(HELD_TITLE);
    expect(levelTitle(playerLevel(HELD_TITLE).payload)).toBe(HELD_TITLE);
    expect(levelTitle(playerSheetLevel("episodes", HELD_TITLE).payload)).toBe(
      HELD_TITLE,
    );
  });
});

/**
 * The whole-row grid (#253, ADR-0036 §1).
 *
 * More on a rail pushes the grid as a level; paging belongs to the rail's quiet
 * head action, and the grid draws the cards the rail has read. Back unwinds it
 * to the rail it came from — the cards the page appended are still there.
 */

const SKIP = { name: "skip", isRequired: false, options: [], optionsLimit: 0 };

const POPULAR: AddonCatalog = {
  type: "movie",
  id: "top",
  name: "Popular",
  extra: [SKIP],
};

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "catalog", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [POPULAR],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
};

const GRID_SNAPSHOT: Snapshot = { ...NOTHING, addons: [CINEMETA] };

function gridMeta(id: string, name: string): MetaPreview {
  return {
    id,
    type: "movie",
    name,
    poster: null,
    posterShape: "poster",
    background: null,
    releaseInfo: "2026",
    imdbRating: null,
    genres: [],
    description: null,
  };
}

function gridRow(metas: MetaPreview[], sent = metas.length): CatalogRow {
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

/** The Host's first page of four, and one more item at skip=4. */
function gridPages(action: Action): Response {
  if (action.type !== "browse_catalog") {
    return { snapshots: [], answer: null };
  }
  const skip = action.extra.find((extra) => extra.name === "skip")?.value;
  return skip === undefined
    ? { snapshots: [], answer: { catalogs: [gridRow([gridMeta("tt1", "One"), gridMeta("tt2", "Two"), gridMeta("tt3", "Three"), gridMeta("tt4", "Four")], 4)] } }
    : { snapshots: [], answer: { catalogs: [gridRow([gridMeta("tt5", "Five")], 1)] } };
}

describe("the Remote's grid level", () => {
  test("More opens it, the grid reads the next page by itself, and Back keeps the cards", async () => {
    const host = new FakeHost(GRID_SNAPSHOT, gridPages);
    const view = render(<RemoteApp link={host} />);
    try {
      await screen.findByTestId("card-cinemeta-tt4");

      fireEvent.click(screen.getByRole("button", { name: "More Popular" }));

      const grid = await screen.findByTestId("remote-grid");
      expect(grid).toHaveAccessibleName("All of Popular");
      expect(screen.getByTestId("grid-card-cinemeta-tt1")).toBeInTheDocument();
      expect(
        within(grid).queryByRole("button", { name: "Read on" }),
        "the grid has no paging button; it reads on near its end",
      ).not.toBeInTheDocument();
      expect(
        await screen.findByTestId("grid-card-cinemeta-tt5"),
        "the grid itself paged the row past its first four",
      ).toBeInTheDocument();
      expect(host.asked("browse_catalog")).toContainEqual({
        type: "browse_catalog",
        addon: "cinemeta",
        catalog: { type: "movie", id: "top" },
        extra: [{ name: "skip", value: "4" }],
      });

      fireEvent.keyDown(window, { key: "Escape" });
      await waitFor(() =>
        expect(screen.queryByTestId("remote-grid")).not.toBeInTheDocument(),
      );

      expect(
        await screen.findByTestId("card-cinemeta-tt5"),
        "the page read in the grid is in the rail after Back",
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "More Popular" }));
      expect(
        await screen.findByTestId("grid-card-cinemeta-tt5"),
        "the grid draws the row the rail has read",
      ).toBeInTheDocument();
    } finally {
      view.unmount();
    }
  });
});

const CONFIRM: Level<RemotePayload> = {
  id: "level-1",
  name: "Remove Cinemeta?",
  kind: "overlay",
  payload: {
    kind: "confirm",
    confirm: {
      id: "confirm-remove-cinemeta",
      title: "Remove Cinemeta?",
      body: "The Host stops asking this Addon for Catalogs, Meta previews and Streams.",
      confirmLabel: "Remove",
      action: { type: "remove_addon", id: "cinemeta" },
    },
  },
};

/**
 * The confirm kind B5 adds (#209, ADR-0035 §1).
 *
 * A destructive question is a level like any other: it carries its words and
 * its Action as data, Cancel pops it and asks nothing, and only the confirming
 * answer reaches the Host — through the Session, and then the level pops.
 */
describe("the Remote's confirm level", () => {
  test("draws the question, and Cancel pops it without dispatching", () => {
    const host = new FakeHost(NOTHING);
    const session = new Session(host);
    const pop = vi.fn();
    render(
      <RemoteLevel
        level={CONFIRM}
        session={session}
        state={session.getState()}
        push={() => "level-2"}
        pop={pop}
      />,
    );

    expect(
      screen.getByRole("dialog", { name: "Remove Cinemeta?" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(pop).toHaveBeenCalledOnce();
    expect(host.actions).toEqual([]);
  });

  test("confirming takes the Action once, then pops the question", async () => {
    const host = new FakeHost(NOTHING);
    const session = new Session(host);
    const pop = vi.fn();
    render(
      <RemoteLevel
        level={CONFIRM}
        session={session}
        state={session.getState()}
        push={() => "level-2"}
        pop={pop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    await waitFor(() => expect(pop).toHaveBeenCalledOnce());
    expect(host.asked("remove_addon")).toEqual([
      { type: "remove_addon", id: "cinemeta" },
    ]);
  });

  test("a refusal keeps the question open with the Host's words", async () => {
    const refusal: ActionError = {
      kind: "store",
      detail: "the database is locked",
    };
    const host = new FakeHost(NOTHING, () => refusal);
    const session = new Session(host);
    const pop = vi.fn();
    render(
      <RemoteLevel
        level={CONFIRM}
        session={session}
        state={session.getState()}
        push={() => "level-2"}
        pop={pop}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(explain(refusal));
    expect(
      screen.getByRole("dialog", { name: "Remove Cinemeta?" }),
    ).toBeInTheDocument();
    expect(pop).not.toHaveBeenCalled();
    expect(host.asked("remove_addon")).toHaveLength(1);
  });
});

/**
 * The player kind B8 adds (#213, ADR-0035 §2).
 *
 * The expanded card is a level like any other: the strip pushes it, it draws
 * the core's playback facts over the destination it was opened from, and Back
 * pops it without asking the Host anything — Stop is the card's own control.
 */
describe("the Remote's player level", () => {
  test("draws the playing Stream's card, and Back pops it without stopping", async () => {
    const playing: Snapshot = {
      ...NOTHING,
      revision: 2,
      playback: {
        ...NOTHING.playback,
        state: "playing",
        nowPlaying: {
          video: { type: "movie", id: "tt1" },
          addon: "torrentio",
          name: "Torrentio\n4k DV",
          description: null,
          filename: "film.mkv",
          bingeGroup: null,
        },
        position: 10,
        duration: 100,
        volume: 60,
        muted: false,
      },
    };
    const host = new FakeHost(playing);
    const session = new Session(host);
    const stop = session.start();
    const pop = vi.fn();

    try {
      await waitFor(() => expect(session.getState().snapshot).not.toBeNull());
      render(
        <RemoteLevel
          level={{ ...playerLevel(), id: "level-1" }}
          session={session}
          state={session.getState()}
          push={() => "level-2"}
          pop={pop}
        />,
      );

      expect(screen.getByRole("region", { name: CARD_NAME })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Back" }));
      expect(pop).toHaveBeenCalledOnce();
      expect(host.actions).toEqual([]);
    } finally {
      stop();
    }
  });
});

/**
 * The Episodes sheet's one decision (#215, from the P2 walk).
 *
 * An episode is a Video like any other, so pressing one opens the Streams list
 * the Title's Play opens — the person chooses a candidate there rather than the
 * client picking one behind their back. The sheet goes first, so one Back
 * leaves the list for the card.
 */
describe("the Episodes sheet's press", () => {
  test("opens the Streams level for the episode, and the plate is put away", async () => {
    const playing: Snapshot = {
      ...NOTHING,
      revision: 2,
      playback: {
        ...NOTHING.playback,
        state: "playing",
        position: 10,
        duration: 100,
      },
    };
    const host = new FakeHost(playing);
    const session = new Session(host);
    const stop = session.start();
    const pop = vi.fn();
    const push = vi.fn(() => "level-2");
    // The Episodes plate lists the Title's own Videos, so this case needs one.
    const series: Title = { ...HELD_TITLE, videos: [HELD_VIDEO] };

    try {
      await waitFor(() => expect(session.getState().snapshot).not.toBeNull());
      render(
        <RemoteLevel
          level={{ ...playerSheetLevel("episodes", series), id: "sheet" }}
          session={session}
          state={session.getState()}
          push={push}
          pop={pop}
        />,
      );

      const episode = HELD_VIDEO;
      fireEvent.click(screen.getByTestId(`episode-${episode.id}`));

      expect(pop).toHaveBeenCalledOnce();
      expect(push).toHaveBeenCalledOnce();
      expect(push).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "Streams",
          kind: "overlay",
          payload: { kind: "streams", title: series, video: episode },
        }),
      );
      expect(host.actions).toEqual([]);
    } finally {
      stop();
    }
  });
});

/**
 * The settings kind B7 adds (#211, ADR-0035 §1).
 *
 * A Settings category is a level like any other: the register's id names it,
 * the leaf draws over the destination it was opened from, and Back pops it —
 * without the Host being asked anything.
 */
describe("the Remote's settings level", () => {
  test("draws its leaf, and Back pops it without dispatching", () => {
    const host = new FakeHost(NOTHING);
    const session = new Session(host);
    const pop = vi.fn();
    const category = SETTINGS_CATEGORIES[1]!;

    render(
      <RemoteLevel
        level={{ ...settingsLevel(category), id: "level-1" }}
        session={session}
        state={session.getState()}
        push={() => "level-2"}
        pop={pop}
      />,
    );

    expect(screen.getByTestId(settingsLevelId(category))).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(pop).toHaveBeenCalledOnce();
    expect(host.actions).toEqual([]);
  });
});
