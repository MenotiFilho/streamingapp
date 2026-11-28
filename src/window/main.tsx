import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installInputModality } from "../core/inputModality";
import { installPointerPress } from "../core/react/pointerPress";
import { MarqueeEntry } from "./marquee/MarqueeEntry";
import { MarqueeRehearsalEntry } from "./marquee/MarqueeRehearsalEntry";
import { RehearsalEntry } from "./repertory/RehearsalEntry";
import { RepertoryEntry } from "./repertory/RepertoryEntry";
import { focusAndReveal } from "./reveal";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the window has no root element to render into");
}

// The last input decides whether focus is drawn and revealed (ADR-0037), and
// a cut-off first press in a row focuses instead of activating (#245). Both
// listen before React mounts, so the first press is already judged.
installInputModality(document.documentElement);
installPointerPress(document.documentElement, {
  focusAndReveal: (control) =>
    focusAndReveal(control, { mode: "nearest", force: true }),
});

/**
 * The window is the ten-foot shell (#87, #160).
 *
 * Repertory remains the default until the Wave 4 cutover (#365).
 * TEMPORARY coexistence switch (#358):
 * - `VITE_UI=marquee` selects the Marquee shell over `TauriLink`.
 * - `VITE_UI=marquee-rehearsal` (or `?ui=marquee-rehearsal`) selects Marquee
 *   over `PreviewLink` for browser verification.
 * - `VITE_UI=rehearsal` selects the Repertory rehearsal entry.
 */
const envUi = import.meta.env.VITE_UI;
const queryUi =
  typeof window !== "undefined"
    ? new URLSearchParams(window.location.search).get("ui")
    : null;
const mode = envUi ?? queryUi;

function entryFor(selected: string | null | undefined) {
  switch (selected) {
    case "marquee":
      return <MarqueeEntry />;
    case "marquee-rehearsal":
      return <MarqueeRehearsalEntry />;
    case "rehearsal":
      return <RehearsalEntry />;
    default:
      return <RepertoryEntry />;
  }
}

createRoot(root).render(<StrictMode>{entryFor(mode)}</StrictMode>);
