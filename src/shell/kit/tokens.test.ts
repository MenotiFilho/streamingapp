import { describe, expect, test } from "vitest";

import kit from "./kit.css?raw";
import tokens from "../../tokens.css?raw";

/** The custom property's value, with the whitespace of a wrapped declaration folded. */
function token(name: string): string | undefined {
  const match = tokens.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match?.[1]?.replace(/\s+/g, " ").trim();
}

/** The locked Variant C (Velvet Curtains) palette, exactly as the design record names it. */
const PALETTE: Record<string, string> = {
  "--bg-canvas": "#09080c",
  "--bg-stage": "#121018",
  "--bg-raised": "#1a1723",
  "--bg-elevated": "#242030",
  "--bg-glass": "rgba(22, 19, 30, 0.78)",
  "--bg-glass-solid": "#101014f2",
  "--border-subtle": "rgba(255, 255, 255, 0.08)",
  "--border-strong": "rgba(255, 255, 255, 0.16)",
  "--ink-primary": "#faf8f5",
  "--ink-secondary": "#a39eb2",
  "--ink-muted": "#696478",
  "--ink-on-accent": "#ffffff",
  "--accent": "#ff4d4d",
  "--accent-soft": "rgba(255, 77, 77, 0.18)",
  "--accent-glow": "rgba(255, 77, 77, 0.48)",
  "--status-warn": "#f5b041",
  "--status-danger": "#ff5c77",
  "--status-danger-bg": "rgba(255, 92, 119, 0.16)",
  "--status-ok": "#58d68d",
};

const TYPE_SCALE: Record<string, string> = {
  "--text-hero": "clamp(2rem, 2.8vw, 3rem)",
  "--text-title": "clamp(1.4rem, 1.9vw, 1.95rem)",
  "--text-section": "1.1rem",
  "--text-body": "0.95rem",
  "--text-caption": "0.8125rem",
  "--text-micro": "0.72rem",
};

const SPACING: Record<string, string> = {
  "--space-1": "0.25rem",
  "--space-2": "0.5rem",
  "--space-3": "0.75rem",
  "--space-4": "1rem",
  "--space-5": "1.5rem",
  "--space-6": "2.25rem",
};

const RADII: Record<string, string> = {
  "--radius-card": "12px",
  "--radius-panel": "18px",
  "--radius-control": "12px",
  "--radius-pill": "999px",
};

const MOTION: Record<string, string> = {
  "--ease-out": "cubic-bezier(0.22, 1, 0.36, 1)",
  "--dur-fast": "140ms",
  "--dur-med": "240ms",
  "--dur-slow": "400ms",
};

describe("the locked Velvet Curtains tokens", () => {
  test.each(Object.entries(PALETTE))("%s is locked to its palette value", (name, value) => {
    expect(token(name)).toBe(value);
  });

  test.each(Object.entries(TYPE_SCALE))("%s is the 10-foot type scale", (name, value) => {
    expect(token(name)).toBe(value);
  });

  test.each(Object.entries(SPACING))("%s is one of the spacing steps", (name, value) => {
    expect(token(name)).toBe(value);
  });

  test.each(Object.entries(RADII))("%s is one of the locked radii", (name, value) => {
    expect(token(name)).toBe(value);
  });

  test.each(Object.entries(MOTION))("%s is one of the locked motion values", (name, value) => {
    expect(token(name)).toBe(value);
  });

  test("the display and UI fonts are the self-hosted families, with tabular figures", () => {
    expect(token("--font-display")).toContain('"Syne Variable"');
    expect(token("--font-sans")).toContain('"Plus Jakarta Sans Variable"');
    expect(token("--font-mono")).toContain('"Plus Jakarta Sans Variable"');
    expect(token("--display-weight")).toBe("700");
    expect(token("--display-tracking")).toBe("-0.025em");
    expect(token("--numeric-figures")).toBe("tabular-nums");
  });

  test("the focus treatment is the ivory ring with the lift", () => {
    const ring = token("--focus-ring");
    expect(ring).toBe(
      "0 0 0 3px var(--ink-primary), 0 16px 36px -4px rgba(0, 0, 0, 0.85)",
    );
    expect(token("--focus-transform")).toBe("translateY(-4px) scale(1.04)");
    expect(token("--focus-fill")).toBe("var(--accent)");
    expect(token("--focus-fill-ink")).toBe("var(--ink-on-accent)");
    expect(token("--focus-fill-border")).toBe("var(--ink-primary)");
  });

  test("reduced motion collapses the duration tokens and the lift", () => {
    expect(tokens).toContain("@media (prefers-reduced-motion: reduce)");
    expect(tokens).toMatch(/--dur-fast:\s*0ms/);
    expect(tokens).toMatch(/--dur-med:\s*0ms/);
    expect(tokens).toMatch(/--dur-slow:\s*0ms/);
    expect(tokens).toMatch(/--focus-transform:\s*none/);
  });
});

describe("the kit's focus treatment", () => {
  test("reuses the two halves of the token treatment for cards and controls", () => {
    expect(kit).toContain(".kit-focus-lift[data-focusable]:focus");
    expect(kit).toContain("transform: var(--focus-transform)");
    expect(kit).toContain(".kit-focus-invert[data-focusable]:focus");
    expect(kit).toContain("background: var(--focus-fill)");
    expect(kit).toContain("border-color: var(--focus-fill-border)");
    expect(kit).toContain("color: var(--focus-fill-ink)");
  });

  test("measures the layout box while a level is being read", () => {
    expect(kit).toContain("[data-measuring] [data-focusable]");
    expect(kit).toContain("transition: none !important");
    expect(kit).toContain("transform: none !important");
  });
});

describe("the kit's self-hosted fonts", () => {
  test("imports the fontsource packages and the token sheet, with no remote font request", () => {
    expect(kit).toContain('@import "@fontsource-variable/syne"');
    expect(kit).toContain('@import "@fontsource-variable/plus-jakarta-sans"');
    expect(kit).toContain('@import "../../tokens.css"');
    expect(kit).not.toContain("fonts.googleapis.com");
    expect(kit).not.toContain("fonts.gstatic.com");
    expect(kit).not.toMatch(/@import\s+url\(/);
  });
});
