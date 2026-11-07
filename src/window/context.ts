import { createContext, useContext } from "react";

import type { ActionOutcome } from "../core/answers";
import type { Action, Response, Snapshot } from "../core/wire";
import type { ActionError } from "../core/errors";
import type { Intent } from "../core/input";
import type { HomeStore } from "../core/homeStore";
import type { Session } from "../core/session";
import type { Destination, NewShellLevel } from "./navigation";

export type { NewShellLevel };

/**
 * What taking an Action came to: the answer, or why the Host refused it. It is
 * the core's answer shape; the window re-exports it so a screen that reads the
 * shell keeps one import.
 */
export type { ActionOutcome };

/** What every screen under the shell can ask of it. */
export type ShellContextValue = {
  /** The one Session over this client's link: the Snapshot, the pending keys and the one alert. */
  session: Session;
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
   * The keys of the Actions this client has sent and whose answers are still on
   * their way. A control derives its wait from its own Action's key, so a
   * double press is one dispatch and a repeated Action is a new step (#137).
   */
  pending: ReadonlySet<string>;
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
   * Take a fire-and-forget Action — the look hint a card sends once it has been
   * rested on (#278, ADR-0038 §3). Nothing is awaited or kept, and a refusal is
   * not raised as the window's alert.
   */
  hint: (action: Action) => void;
  /**
   * Home's session browse: the rows this client has read, their pages, and the
   * asks still in flight. It lives above the screen so leaving Home does not
   * throw the rows away (#112); what one client is looking at stays its own
   * browse and never travels as a Snapshot (ADR-0005).
   */
  home: HomeStore;
  /**
   * Hand the shell the player's own handler for an intent that is not Back —
   * its Up/Down ladder and its volume. The player rewrites it on every render
   * with the one that matches the screen; the level the shell built reads it
   * through a ref, so the level never has to be rebuilt.
   */
  setIntentHandler: (handler: ((intent: Intent) => boolean) | null) => void;
  /**
   * The base screen's first look at an intent, where it needs one — the
   * feature's Left/Right stepping is the same for the D-pad and the arrow keys,
   * so it lives here rather than in a key handler.
   */
  setBaseIntentHandler: (handler: ((intent: Intent) => boolean) | null) => () => void;
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
