/**
 * The client core's navigation: six destinations, and a stack of levels above
 * whichever one is showing.
 *
 * A destination is not a level. The rail is persistent, so choosing one
 * replaces the base screen; Back on a screen returns to Home rather than
 * walking back through every icon visited. Only an overlay — a Title, the
 * Streams list, a Settings sub-screen, a confirmation, a player popover — is
 * pushed, and Back pops it to the exact focus underneath (#51, #52).
 *
 * What a level holds belongs to the client that draws it: the window puts its
 * own drawing in the payload, the Remote puts its own. The rules for the
 * stack are here, because both clients decide them the same way (ADR-0035).
 */

import { DESTINATIONS, type Destination } from "./destinations";

/**
 * One pushed level. `kind` is what Back needs to know beyond "pop it": a
 * `player` level is the one Back stops, and every other level is a surface the
 * client can put away. A `popover` is the player's own furniture — an icon's
 * menu — and paints above the player rather than beside it.
 */
export type Level<P> = {
  id: string;
  /** What the level is, for a test, an announcement, or a settings sub-screen. */
  name: string;
  kind: "overlay" | "player" | "popover";
  /** The level's contents, as the client that pushed it holds them. */
  payload: P;
};

/** A level a client asks for; the navigation gives it its id. */
export type NewLevel<P> = Omit<Level<P>, "id"> & { id?: string };

/** A client's whole navigation state. */
export type Navigation<P> = {
  destination: Destination;
  /** Outermost first; the last level is the one a person is on. */
  levels: Level<P>[];
};

export const INITIAL_NAVIGATION: Navigation<never> = { destination: "home", levels: [] };

/** Everything a person can do to the stack. */
export type NavigationEvent<P> =
  | { type: "choose"; destination: Destination }
  | { type: "push"; level: Level<P> }
  | { type: "pop" }
  | { type: "remove"; id: string }
  | { type: "remove-from"; id: string }
  | { type: "back" };

/** The label a destination is announced and drawn by. */
export function destinationLabel(destination: Destination): string {
  return DESTINATIONS.find((entry) => entry.id === destination)?.label ?? "Home";
}

/** Push one level, keeping everything below it exactly where it was. */
export function pushLevel<P>(state: Navigation<P>, level: Level<P>): Navigation<P> {
  const at = state.levels.findIndex((held) => held.id === level.id);
  if (at < 0) {
    return { ...state, levels: [...state.levels, level] };
  }
  const levels = state.levels.slice();
  levels[at] = level;
  return { ...state, levels };
}

/** Take one level out by id, wherever it sits. */
export function removeLevel<P>(state: Navigation<P>, id: string): Navigation<P> {
  return state.levels.some((level) => level.id === id)
    ? { ...state, levels: state.levels.filter((level) => level.id !== id) }
    : state;
}

/**
 * Take a level out along with everything above it. This is what a takeover
 * uses when it ends: a player's open popovers belong to the player, not to the
 * screen the player was over.
 */
export function removeFrom<P>(state: Navigation<P>, id: string): Navigation<P> {
  const at = state.levels.findIndex((level) => level.id === id);
  return at < 0 ? state : { ...state, levels: state.levels.slice(0, at) };
}

/** Pop the top level, if there is one. */
export function popLevel<P>(state: Navigation<P>): Navigation<P> {
  return state.levels.length === 0
    ? state
    : { ...state, levels: state.levels.slice(0, -1) };
}

/**
 * Back: pop one pushed level, or return a non-Home base screen to Home. On
 * Home with nothing pushed, Back is a wall.
 */
export function back<P>(state: Navigation<P>): Navigation<P> {
  if (state.levels.length > 0) {
    return popLevel(state);
  }
  if (state.destination !== "home") {
    return { destination: "home", levels: [] };
  }
  return state;
}

/**
 * Whether Back has anywhere to go: a level to pop, or a base screen other than
 * Home. It is true exactly when `back` would change the state.
 */
export function canGoBack(state: Navigation<unknown>): boolean {
  return state.levels.length > 0 || state.destination !== "home";
}

/** Apply one navigation event. */
export function navigate<P>(
  state: Navigation<P>,
  event: NavigationEvent<P>,
): Navigation<P> {
  switch (event.type) {
    case "choose":
      // A destination replaces the base. An overlay over the place it replaced
      // would be a level of a place a person has left; the rail is the one
      // control that gets to change the base, so it closes what was above.
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
