import { describe, expect, test } from "vitest";

import {
  INITIAL_NAVIGATION,
  back,
  canGoBack,
  destinationLabel,
  navigate,
  type Level,
  type Navigation,
} from "./navigation";
import { DESTINATIONS } from "./destinations";

/** The client's own payload, standing in for the window's own contents. */
type Payload = { label: string };

const level = (
  id: string,
  kind: Level<Payload>["kind"] = "overlay",
  label = id,
): Level<Payload> => ({
  id,
  name: id,
  kind,
  payload: { label },
});

/** The initial state, as a client that holds a payload reads it. */
const initial: Navigation<Payload> = INITIAL_NAVIGATION;

describe("the six destinations", () => {
  test("are Home, Discover, Search, Library, Addons and Settings, in that order", () => {
    expect(DESTINATIONS.map((destination) => destination.label)).toEqual([
      "Home",
      "Discover",
      "Search",
      "Library",
      "Addons",
      "Settings",
    ]);
  });

  test("each has a name a screen reads", () => {
    expect(destinationLabel("home")).toBe("Home");
    expect(destinationLabel("settings")).toBe("Settings");
  });
});

describe("the level stack", () => {
  test("starts on Home with nothing pushed", () => {
    expect(INITIAL_NAVIGATION).toEqual({ destination: "home", levels: [] });
  });

  test("choosing a destination replaces the base screen and clears overlays", () => {
    const held: Navigation<Payload> = {
      destination: "home",
      levels: [level("title"), level("streams")],
    };

    expect(navigate(held, { type: "choose", destination: "addons" })).toEqual({
      destination: "addons",
      levels: [],
    });
  });

  test("pushing an overlay keeps the level underneath, untouched", () => {
    const held = navigate(initial, { type: "push", level: level("title") });
    const pushed = navigate(held, { type: "push", level: level("streams") });

    expect(pushed.levels.map((entry) => entry.id)).toEqual(["title", "streams"]);
    expect(pushed.destination).toBe("home");
  });

  test("pushing the same id again replaces it in place, without stacking a copy", () => {
    const held: Navigation<Payload> = {
      destination: "home",
      levels: [level("title"), level("player", "player")],
    };
    const pushed = navigate(held, { type: "push", level: level("player", "player") });

    expect(pushed.levels.map((entry) => entry.id)).toEqual(["title", "player"]);
  });

  test("pushing the same id again keeps the new payload, not the one it replaced", () => {
    const held: Navigation<Payload> = {
      destination: "home",
      levels: [level("title", "overlay", "old")],
    };

    const pushed = navigate(held, {
      type: "push",
      level: level("title", "overlay", "new"),
    });

    expect(pushed.levels).toHaveLength(1);
    expect(pushed.levels[0]?.payload).toEqual({ label: "new" });
  });

  test("removing a level by id leaves the others in order", () => {
    const held: Navigation<Payload> = {
      destination: "home",
      levels: [level("title"), level("player", "player")],
    };

    const removed = navigate(held, { type: "remove", id: "player" });
    expect(removed.levels.map((entry) => entry.id)).toEqual(["title"]);
  });

  test("removing a takeaway level takes everything it had opened above it", () => {
    const held: Navigation<Payload> = {
      destination: "home",
      levels: [level("title"), level("player", "player"), level("popover")],
    };

    const removed = navigate(held, { type: "remove-from", id: "player" });
    expect(removed.levels.map((entry) => entry.id)).toEqual(["title"]);
  });

  test("Back pops one overlay and leaves the base alone", () => {
    const held: Navigation<Payload> = {
      destination: "home",
      levels: [level("title"), level("streams")],
    };

    const popped = back(held);
    expect(popped.destination).toBe("home");
    expect(popped.levels.map((entry) => entry.id)).toEqual(["title"]);
  });

  test("Back with nothing pushed returns a non-Home screen to Home", () => {
    expect(back({ destination: "settings", levels: [] })).toEqual({
      destination: "home",
      levels: [],
    });
  });

  test("Back on Home with nothing pushed is a wall", () => {
    expect(back(INITIAL_NAVIGATION)).toEqual(INITIAL_NAVIGATION);
  });

  test("a player is a level like any other, so stacking it over the browse works", () => {
    const watching = navigate(INITIAL_NAVIGATION, {
      type: "push",
      level: level("player", "player"),
    });

    expect(watching.levels).toHaveLength(1);
    expect(watching.levels[0]?.kind).toBe("player");
  });
});

describe("canGoBack", () => {
  test("is false on Home with nothing pushed", () => {
    expect(canGoBack(INITIAL_NAVIGATION)).toBe(false);
  });

  test("is true when a level is pushed", () => {
    expect(canGoBack(navigate(initial, { type: "push", level: level("title") }))).toBe(
      true,
    );
  });

  test("is true on a non-Home destination with nothing pushed", () => {
    expect(canGoBack({ destination: "settings", levels: [] })).toBe(true);
  });
});
