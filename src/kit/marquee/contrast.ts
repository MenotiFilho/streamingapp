/**
 * WCAG 2.2 contrast math for the Marquee palette (`docs/design-system.md` §2).
 *
 * Pure and self-contained inside `src/kit/marquee/` so the token lock reads
 * colors and alphas directly from `tokens.css` without depending on any client
 * screen or legacy sheet.
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

function toRgb(color: string | Rgb): Rgb {
  return typeof color === "string" ? parseHex(color) : color;
}

/**
 * Alpha-composite `foreground` at `alpha` (0..1) over opaque `background` in
 * sRGB, matching how the browser blends translucent white text and glass over
 * dark surfaces.
 */
export function compositeOver(
  foreground: string | Rgb,
  background: string | Rgb,
  alpha: number,
): Rgb {
  if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) {
    throw new Error(`alpha must be in [0, 1], got ${alpha}`);
  }
  const fg = toRgb(foreground);
  const bg = toRgb(background);
  return {
    r: fg.r * alpha + bg.r * (1 - alpha),
    g: fg.g * alpha + bg.g * (1 - alpha),
    b: fg.b * alpha + bg.b * (1 - alpha),
  };
}

/** One sRGB channel, linearised as WCAG 2.2 defines it. */
function linear(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.2 relative luminance for a hex colour or sRGB triple. */
export function relativeLuminance(color: string | Rgb): number {
  const { r, g, b } = toRgb(color);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** WCAG 2.2 contrast ratio, unrounded. Order does not matter. */
export function contrastRatio(a: string | Rgb, b: string | Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Read one CSS custom property declaration, whitespace flattened, or throw. */
export function readDeclaration(css: string, name: string): string {
  const match = new RegExp(`(^|[\\s{;])${name}\\s*:\\s*([^;]+);`).exec(css);
  if (!match?.[2]) {
    throw new Error(`the sheet does not declare ${name}`);
  }
  return match[2].replace(/\s+/g, " ").trim();
}

/** Read a hex custom property out of a CSS sheet, or throw. */
export function readHexToken(css: string, name: string): string {
  const value = readDeclaration(css, name);
  if (!/^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$/.test(value)) {
    throw new Error(`${name} is not a hex colour: ${value}`);
  }
  return value;
}

/** Read a unitless numeric custom property (such as an alpha) out of a CSS sheet, or throw. */
export function readNumberToken(css: string, name: string): number {
  const value = readDeclaration(css, name);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} is not a finite number: ${value}`);
  }
  return parsed;
}
