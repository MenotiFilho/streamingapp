/**
 * The repertory palette, in one place.
 *
 * These values are applied to the document as CSS custom properties before the
 * first paint, so `repertory.css` can name them without repeating a hex value.
 * The measured pairs live in `tokens.test.ts`; a change here fails that test
 * until the new pair is measured.
 */

export const REPERTORY_PALETTE = {
  ink: "#0b0a09",
  inkRaised: "#141210",
  inkElevated: "#1b1815",
  ivory: "#f2e9d8",
  dim: "#c8bda9",
  muted: "#8c8375",
  hairline: "#6e6659",
  house: "#c9a45c",
  houseDeep: "#b08a45",
  statusRed: "#ff4d4d",
} as const;

/** Apply the palette to the document root, where every repertory screen reads it. */
export function applyPalette(root: HTMLElement): void {
  root.style.setProperty("--rep-ink", REPERTORY_PALETTE.ink);
  root.style.setProperty("--rep-ink-raised", REPERTORY_PALETTE.inkRaised);
  root.style.setProperty("--rep-ink-elevated", REPERTORY_PALETTE.inkElevated);
  root.style.setProperty("--rep-ivory", REPERTORY_PALETTE.ivory);
  root.style.setProperty("--rep-dim", REPERTORY_PALETTE.dim);
  root.style.setProperty("--rep-muted", REPERTORY_PALETTE.muted);
  root.style.setProperty("--rep-hairline", REPERTORY_PALETTE.hairline);
  root.style.setProperty("--rep-house", REPERTORY_PALETTE.house);
  root.style.setProperty("--rep-house-deep", REPERTORY_PALETTE.houseDeep);
  root.style.setProperty("--rep-status-red", REPERTORY_PALETTE.statusRed);
}

/** Take the palette off again, for a window that leaves the repertory surface. */
export function clearPalette(root: HTMLElement): void {
  for (const name of [
    "--rep-ink",
    "--rep-ink-raised",
    "--rep-ink-elevated",
    "--rep-ivory",
    "--rep-dim",
    "--rep-muted",
    "--rep-hairline",
    "--rep-house",
    "--rep-house-deep",
    "--rep-status-red",
  ]) {
    root.style.removeProperty(name);
  }
}
