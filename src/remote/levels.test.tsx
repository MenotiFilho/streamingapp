import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { explain, type ActionError } from "../core/errors";
import type { Level } from "../core/navigation";
import { Session } from "../core/session";
import {
  SETTINGS_CATEGORIES,
  settingsLevelId,
} from "../core/settingsRegister";
import type { ResumeEntry, Snapshot } from "../core/wire";
import { RemoteApp } from "./RemoteApp";
import { FakeHost } from "./fakeHost.testing";
import { ISSUED_TOKEN, NOTHING, PHONE, fakeLink } from "./fakeSocket.testing";
import {
  RemoteLevel,
  titleLevel,
  titleLevelOf,
  type RemotePayload,
} from "./levels";
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

const RESUME: ResumeEntry = {
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

const WITH_PROGRESS: Snapshot = { ...NOTHING, watchProgress: [RESUME] };

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
