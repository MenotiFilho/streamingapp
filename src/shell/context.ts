import { createContext, useContext } from "react";

import type { Action, ActionError, Response, Snapshot } from "../host-client";
import type { Destination, ShellLevel } from "./navigation";

/** A level a screen asks the shell to push; the shell gives it its id. */
export type NewShellLevel = Omit<ShellLevel, "id"> & { id?: string };

/** What taking an Action came to: the answer, or why the Host refused it. */
export type ActionOutcome = {
  response: Response | null;
  error: ActionError | null;
};

/** What every screen under the shell can ask of it. */
export type ShellContextValue = {
  /** What the Host last published, or null before the first answer. */
  snapshot: Snapshot | null;
  /** Why the last Action this window took was refused, where one was. */
  error: ActionError | null;
  destination: Destination;
  /** Whether a person has chosen a destination from the rail. */
  chosenDestination: boolean;
  /**
   * The OSD popover currently open above the player, by level id — the player
   * reads it to mark its icon and to keep itself from hiding under one.
   */
  popover: string | null;
  choose: (destination: Destination) => void;
  /** Push an overlay level. Returns the id the shell gave it. */
  push: (level: NewShellLevel) => string;
  /** Pop the top level, if there is one. */
  pop: () => void;
  /** Back, with the player's stop rule applied. */
  back: () => void;
  /**
   * Take an Action and answer with what came of it, or why the Host refused
   * it. Unlike `take`, a refusal is not raised as the window's one alert: a row
   * that could not load says so in the row, and leaves the rest of the screen
   * alone.
   */
  ask: (action: Action) => Promise<ActionOutcome>;
  /** Take an Action through the Host's one door. */
  take: (action: Action) => Promise<Response | null>;
};

export const ShellContext = createContext<ShellContextValue | null>(null);

/** The shell's context, for a screen that lives inside a pushed level or the base. */
export function useShell(): ShellContextValue {
  const value = useContext(ShellContext);
  if (!value) {
    throw new Error("useShell must be used inside the shell");
  }
  return value;
}
