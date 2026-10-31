import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RehearsalEntry } from "./repertory/RehearsalEntry";
import { RepertoryEntry } from "./repertory/RepertoryEntry";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the window has no root element to render into");
}

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
