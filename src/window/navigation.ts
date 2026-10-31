/**
 * The window's navigation: the core's destinations and level stack, with the
 * payload the window puts in a level — the drawing it holds, and the level's
 * first chances at Back and at an intent.
 *
 * The rules for the stack are the core's (ADR-0035). This module only says
 * what a window level holds, and keeps the names the window's screens import.
 */

import type { ReactNode } from "react";

import type { Intent } from "../core/input";
import type { Level, Navigation as CoreNavigation, NewLevel } from "../core/navigation";

// The destinations are the core's; the window's screens read them by these
// names so the move is invisible to every consumer.
export { DESTINATIONS, type Destination } from "../core/destinations";

/** What a window level holds: its drawing, and its own first look at input. */
export type WindowPayload = {
  /** The level's contents, drawn when it is on top of the stack. */
  render: () => ReactNode;
  /**
   * A first chance to consume Back inside the level — an open OSD popover, a
   * confirmation that wants to cancel itself. Return true to consume it; the
   * shell then leaves the stack alone.
   */
  onBack?: () => boolean;
  /**
   * A first chance at an intent that is not Back, before the focus engine
   * handles it — the player's own Up/Down ladder and its volume. Return true
   * when the level took it.
   */
  onIntent?: (intent: Intent) => boolean;
};

/** One pushed level, as the window holds it. */
export type ShellLevel = Level<WindowPayload>;

/** A level a screen asks the shell to push; the shell gives it its id. */
export type NewShellLevel = NewLevel<WindowPayload>;

/** The window's whole navigation state. */
export type Navigation = CoreNavigation<WindowPayload>;
