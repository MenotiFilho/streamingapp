import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Shell } from "./shell";
import { RepertoryEntry } from "./shell/repertory/RepertoryEntry";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the window has no root element to render into");
}

/**
 * The window is the ten-foot shell (#87).
 *
 * There is one client: `src/shell/` takes Actions from the Host and renders the
 * Snapshots it is sent. `src/tokens.css`, imported by the shell's kit, is its
 * only palette. The repertory prototype (#145) is the same client under a new
 * frame, selected at build time and living behind `VITE_UI=repertory` until
 * the cutover.
 */
const repertory = import.meta.env.VITE_UI === "repertory";

createRoot(root).render(
  <StrictMode>{repertory ? <RepertoryEntry /> : <Shell />}</StrictMode>,
);
