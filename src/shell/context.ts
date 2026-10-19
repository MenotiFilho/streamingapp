import { createContext, useContext } from "react";

import type { Action, ActionError, Response, Snapshot } from "../host-client";
import type { Destination, ShellLevel } from "./navigation";

/** A level a screen asks the shell to push; the shell gives it its id. */
export type NewShellLevel = Omit<ShellLevel, "id"> & { id?: string };

/** What every screen under the shell can ask of it. */
export type ShellContextValue = {
  /** What the Host last published, or null before the first answer. */
  snapshot: Snapshot | null;
  /** Why the last Action this window took was refused, where one was. */
  error: ActionError | null;
  destination: Destination;
  choose: (destination: Destination) => void;
  /** Push an overlay level. Returns the id the shell gave it. */
  push: (level: NewShellLevel) => string;
  /** Pop the top level, if there is one. */
  pop: () => void;
  /** Back, with the player's stop rule applied. */
  back: () => void;
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
