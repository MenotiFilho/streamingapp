/**
 * WCAG 2.2 contrast math for the repertory palette.
 *
 * The palette's pairs are measured, not eyeballed (research #144). This module
 * is pure so the same calculation can guard the tokens in a unit test; the
 * test reads the hex values out of `repertory.css`, so the sheet cannot drift
 * from the numbers the review approved.
 */

export type Rgb = { r: number; g: number; b: number };

/** Parse `#rrggbb` or `#rgb` into sRGB channels from 0 to 1. */
export function parseHex(hex: string): Rgb {
  const value = hex.trim().replace(/^#/, "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((part) => part + part)
          .join("")
      : value;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) {
    throw new Error(`not a hex colour: ${hex}`);
  }
  return {
    r: Number.parseInt(full.slice(0, 2), 16) / 255,
    g: Number.parseInt(full.slice(2, 4), 16) / 255,
    b: Number.parseInt(full.slice(4, 6), 16) / 255,
  };
}

/** One sRGB channel, linearised as WCAG 2.2 defines it. */
function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG contrast ratio, unrounded. Order does not matter. */
export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Read a custom property out of a CSS sheet, or throw so a missing token fails the test. */
export function readToken(css: string, name: string): string {
  const match = css.match(new RegExp(`${name}\\s*:\\s*(#[0-9a-fA-F]{3,6})\\s*;`));
  if (!match?.[1]) {
    throw new Error(`the sheet does not declare ${name}`);
  }
  return match[1];
}
