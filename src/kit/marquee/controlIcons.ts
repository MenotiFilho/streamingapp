import type { IconName, IconWeight } from "./icons";

const TRANSPORT: ReadonlySet<IconName> = new Set([
  "play",
  "pause",
  "stop",
  "skip-back",
  "skip-forward",
]);

/**
 * The weight a control draws a glyph in when its caller names none
 * (`docs/design-system.md` §7): fill for transport, bold for checks, regular
 * for chrome.
 */
export function defaultIconWeight(name: IconName): IconWeight {
  if (TRANSPORT.has(name)) {
    return "fill";
  }
  return name === "check" ? "bold" : "regular";
}

/** A destination's glyph is filled when it is the active one or has focus. */
export function navIconWeight(state: { active: boolean; focusShown: boolean }): IconWeight {
  return state.active || state.focusShown ? "fill" : "regular";
}
