/**
 * What the six Pairing code cells hold (sheet `C8`, "typed once").
 *
 * The Host owns the code's rules (its alphabet, and refusing what is not a
 * code). This only does what the Host's own reading does to what a person
 * types: case and grouping are theirs, not the code's. A character the Host
 * does not use is kept, so the Host refuses it in its own words instead of the
 * page dropping it silently.
 */

/** How many characters a Pairing code is. */
export const PAIRING_CODE_LENGTH = 6;

/** What was typed or pasted, as the cells hold it. */
export function normalizePairingEntry(raw: string): string {
  return raw
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase()
    .slice(0, PAIRING_CODE_LENGTH);
}

export type PairingCell = {
  /** The character typed there, or empty. */
  char: string;
  /** Whether the next character lands here. */
  active: boolean;
};

/**
 * The six cells for an entry. While the field has focus, the first empty cell is
 * the active one; a full entry has none.
 */
export function pairingCells(value: string, focused: boolean): PairingCell[] {
  const entry = normalizePairingEntry(value);
  return Array.from({ length: PAIRING_CODE_LENGTH }, (_, index) => ({
    char: entry.charAt(index),
    active: focused && index === entry.length,
  }));
}
