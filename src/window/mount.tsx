import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { installInputModality } from "../core/inputModality";
import { installPointerPress } from "../core/react/pointerPress";
import { focusAndReveal } from "./reveal";

/**
 * Put a window entry on the page: the input rules first, then React.
 *
 * The last input decides whether focus is drawn and revealed (ADR-0037), and
 * a cut-off first press in a row focuses instead of activating (#245). Both
 * listen before React mounts, so the first press is already judged.
 */
export function mountWindow(entry: ReactNode): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("the window has no root element to render into");
  }

  installInputModality(document.documentElement);
  installPointerPress(document.documentElement, {
    focusAndReveal: (control) =>
      focusAndReveal(control, { mode: "nearest", force: true }),
  });

  createRoot(root).render(<StrictMode>{entry}</StrictMode>);
}
