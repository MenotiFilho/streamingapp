import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installInputModality } from "../core/inputModality";
import { installPointerPress } from "../core/react/pointerPress";
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
 * The window is the ten-foot repertory shell (#87, #160).
 *
 * There is one client: `src/window/` takes Actions from the Host and renders the
 * Snapshots it is sent. `src/kit/tokens.css` is its only palette.
 * `VITE_UI=rehearsal` selects the browser rehearsal entry that answers from the
 * public Cinemeta addon when no Tauri Host is present; every other build renders
 * the production entry directly.
 */
const rehearsal = import.meta.env.VITE_UI === "rehearsal";

createRoot(root).render(
  <StrictMode>{rehearsal ? <RehearsalEntry /> : <RepertoryEntry />}</StrictMode>,
);
