import { createContext, useContext } from "react";

import type { Action, ActionError, Response, Snapshot } from "../host-client";
import type { HomeStore } from "./homeStore";
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
  /**
   * Titles this client has learned are unplayable, by the id their card
   * carries. A Discover card is marked locally when no configured Addon could
   * ever answer for it, and marked here when a Title is opened and every
   * Addon's Streams answer came back empty (ADR-0020). It is this client's own
   * knowledge, not the Host's state: a fresh window starts without it.
   */
  unplayable: ReadonlySet<string>;
  /**
   * Remember what a Title's Streams answer said: `true` when every Addon
   * answered with no candidate, `false` when a later answer carried one. A
   * failed Addon proves nothing either way, so its caller leaves the mark be.
   */
  markUnplayable: (id: string, unplayable: boolean) => void;
  choose: (destination: Destination) => void;
  /** Push an overlay level. Returns the id the shell gave it. */
  push: (level: NewShellLevel) => string;
  /** Take one level out by id, wherever it sits. */
  remove: (id: string) => void;
  /** Whether a level with this id is still on the stack. */
  levelExists: (id: string) => boolean;
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
  /**
   * Home's session browse: the rows this client has read, their pages, and the
   * asks still in flight. It lives above the screen so leaving Home does not
   * throw the rows away (#112); what one client is looking at stays its own
   * browse and never travels as a Snapshot (ADR-0005).
   */
  home: HomeStore;
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
