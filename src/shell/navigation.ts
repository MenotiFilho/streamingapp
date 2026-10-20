/**
 * The shell's navigation: six destinations, and a stack of overlays above
 * whichever one is showing.
 *
 * A destination is not a level. The rail is persistent, so choosing one
 * replaces the base screen; Back on a screen returns to Home rather than
 * walking back through every icon visited. Only an overlay — a Title, the
 * Streams list, a Settings sub-screen, a confirmation, a player popover — is
 * pushed, and Back pops it to the exact focus underneath (#51, #52).
 */

import type { ReactNode } from "react";

/** The six destinations, in the rail's order. */
export const DESTINATIONS = [
  { id: "home", label: "Home" },
  { id: "discover", label: "Discover" },
  { id: "search", label: "Search" },
  { id: "library", label: "Library" },
  { id: "addons", label: "Addons" },
  { id: "settings", label: "Settings" },
] as const;

/** One of the six persistent destinations. */
export type Destination = (typeof DESTINATIONS)[number]["id"];

/**
 * One pushed level. `kind` is what Back needs to know beyond "pop it": a
 * `player` level is the one Back stops, and every other level is a surface the
 * shell can put away. A `popover` is the player's own furniture — an icon's
 * menu — and paints above the player rather than beside it.
 */
export type ShellLevel = {
  id: string;
  /** What the level is, for a test, an announcement, or a settings sub-screen. */
  name: string;
  kind: "overlay" | "player" | "popover";
  /** The level's contents, drawn when it is on top of the stack. */
  render: () => ReactNode;
  /**
   * A first chance to consume Back inside the level — an open OSD popover, a
   * confirmation that wants to cancel itself. Return true to consume it; the
   * shell then leaves the stack alone.
   */
  onBack?: () => boolean;
};

/** The shell's whole navigation state. */
export type Navigation = {
  destination: Destination;
  /** Outermost first; the last level is the one a person is on. */
  levels: ShellLevel[];
};

export const INITIAL_NAVIGATION: Navigation = { destination: "home", levels: [] };

/** Everything a person can do to the stack. */
export type NavigationEvent =
  | { type: "choose"; destination: Destination }
  | { type: "push"; level: ShellLevel }
  | { type: "pop" }
  | { type: "remove"; id: string }
  | { type: "remove-from"; id: string }
  | { type: "back" };

/** The label a destination is announced and drawn by. */
export function destinationLabel(destination: Destination): string {
  return DESTINATIONS.find((entry) => entry.id === destination)?.label ?? "Home";
}

/** Push one level, keeping everything below it exactly where it was. */
export function pushLevel(state: Navigation, level: ShellLevel): Navigation {
  const at = state.levels.findIndex((held) => held.id === level.id);
  if (at < 0) {
    return { ...state, levels: [...state.levels, level] };
  }
  const levels = state.levels.slice();
  levels[at] = level;
  return { ...state, levels };
}

/** Take one level out by id, wherever it sits. */
export function removeLevel(state: Navigation, id: string): Navigation {
  return state.levels.some((level) => level.id === id)
    ? { ...state, levels: state.levels.filter((level) => level.id !== id) }
    : state;
}

/**
 * Take a level out along with everything above it. This is what a takeover
 * uses when it ends: a player's open popovers belong to the player, not to the
 * screen the player was over.
 */
export function removeFrom(state: Navigation, id: string): Navigation {
  const at = state.levels.findIndex((level) => level.id === id);
  return at < 0 ? state : { ...state, levels: state.levels.slice(0, at) };
}

/** Pop the top level, if there is one. */
export function popLevel(state: Navigation): Navigation {
  return state.levels.length === 0
    ? state
    : { ...state, levels: state.levels.slice(0, -1) };
}

/**
 * Back: pop one pushed level, or return a non-Home base screen to Home. On
 * Home with nothing pushed, Back is a wall.
 */
export function back(state: Navigation): Navigation {
  if (state.levels.length > 0) {
    return popLevel(state);
  }
  if (state.destination !== "home") {
    return { destination: "home", levels: [] };
  }
  return state;
}

/** Apply one navigation event. */
export function navigate(state: Navigation, event: NavigationEvent): Navigation {
  switch (event.type) {
    case "choose":
      // A destination replaces the base screen. An overlay over the screen it
      // replaced would be a level of a place a person has left; the rail is the
      // one control that gets to change the base, so it closes what was above.
      return { destination: event.destination, levels: [] };
    case "push":
      return pushLevel(state, event.level);
    case "pop":
      return popLevel(state);
    case "remove":
      return removeLevel(state, event.id);
    case "remove-from":
      return removeFrom(state, event.id);
    case "back":
      return back(state);
  }
}
