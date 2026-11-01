import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { ResumeEntry, Snapshot } from "../core/wire";
import { RemoteApp } from "./RemoteApp";
import { ISSUED_TOKEN, NOTHING, PHONE, fakeLink } from "./fakeSocket.testing";
import { RemoteLevel, titleLevel, titleLevelOf } from "./levels";

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
      },
    });
  });

  test("the placeholder knows which Title it stands for", () => {
    const level = { ...titleLevel({ addon: null, id: "tt9", type: "movie", name: "Nine" }), id: "level-1" };
    render(<RemoteLevel level={level} />);

    expect(screen.getByRole("heading", { name: "Nine" })).toBeInTheDocument();
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
