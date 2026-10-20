import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { Shell } from "./shell";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the window has no root element to render into");
}

/**
 * The window is the ten-foot shell (#87).
 *
 * There is one client: `src/shell/` takes Actions from the Host and renders the
 * Snapshots it is sent. `src/tokens.css`, imported by the shell's kit, is its
 * only palette.
 */
createRoot(root).render(
  <StrictMode>
    <Shell />
  </StrictMode>,
);
