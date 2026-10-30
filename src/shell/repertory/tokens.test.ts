import { describe, expect, it } from "vitest";

import { contrastRatio, readToken } from "./contrast";
import osdCss from "./osd.css?raw";
import repertoryCss from "./repertory.css?raw";
import tokensCss from "./tokens.css?raw";

const ink = readToken(tokensCss, "--rep-ink");
const inkRaised = readToken(tokensCss, "--rep-ink-raised");
const ivory = readToken(tokensCss, "--rep-ivory");
const dim = readToken(tokensCss, "--rep-dim");
const muted = readToken(tokensCss, "--rep-muted");
const hairline = readToken(tokensCss, "--rep-hairline");
const house = readToken(tokensCss, "--rep-house");
const houseDeep = readToken(tokensCss, "--rep-house-deep");
const statusRed = readToken(tokensCss, "--rep-status-red");

/** Read one declaration out of a sheet, whitespace flattened, or throw. */
function declaration(css: string, name: string): string {
  const match = new RegExp(`${name}\\s*:\\s*([^;]+);`).exec(css);
  if (!match?.[1]) {
    throw new Error(`the sheet does not declare ${name}`);
  }
  return match[1].replace(/\s+/g, " ").trim();
}

describe("the repertory palette", () => {
  it("clears 4.5:1 for every text pair on ink and raised", () => {
    for (const inkSurface of [ink, inkRaised]) {
      expect(contrastRatio(ivory, inkSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(dim, inkSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(muted, inkSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(house, inkSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(houseDeep, inkSurface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(statusRed, inkSurface)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("clears 3:1 for the hairline as a non-text rule", () => {
    expect(contrastRatio(hairline, ink)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(hairline, inkRaised)).toBeGreaterThanOrEqual(3);
  });

  it("keeps brass legible as text, and keeps ivory off brass", () => {
    expect(contrastRatio(house, ink)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ink, house)).toBeGreaterThanOrEqual(4.5);
    // The one measured trap: an ivory label on a brass fill looks right and
    // fails every threshold. The prototype must use ink on brass.
    expect(contrastRatio(ivory, house)).toBeLessThan(3);
  });

  it("lets a red fill carry ink and never ivory", () => {
    expect(contrastRatio(ink, statusRed)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ivory, statusRed)).toBeLessThan(3);
  });
});

describe("the one palette", () => {
  it("declares the brass once: no rgba or hex brass literal anywhere else", () => {
    // Every wash derives from `--rep-house` by `color-mix`, so the one allowed
    // brass correction moves the washes with it (design record §2).
    const brass = /201\s*,\s*164\s*,\s*92|#c9a45c/i;
    const allowed = /^\s*--rep-house(-deep)?\s*:/;
    const sheets: [string, string][] = [
      ["tokens.css", tokensCss],
      ["repertory.css", repertoryCss],
      ["osd.css", osdCss],
      // The kit sheet lands in its own directory while #153 is in flight;
      // guard it when it is there rather than pinning the test to a path that
      // may not exist yet.
      ...Object.entries(
        import.meta.glob<string>("./kit/kit.css", {
          eager: true,
          query: "?raw",
          import: "default",
        }),
      ),
    ];

    for (const [name, css] of sheets) {
      const offenders = css
        .split("\n")
        .filter((line) => brass.test(line) && !allowed.test(line));
      expect(offenders, `${name} repeats the brass outside --rep-house`).toEqual([]);
    }
  });
});

describe("the locked scale, radius and motion", () => {
  it("drives every ten-foot size from the stage unit with a floor and no ceiling", () => {
    expect(declaration(tokensCss, "--rep-stage")).toBe("min(1vw, 1.7778vh)");
    expect(declaration(tokensCss, "--rep-text-hero")).toBe(
      "max(72px, calc(var(--rep-stage) * 4.6))",
    );
    expect(declaration(tokensCss, "--rep-text-title")).toBe(
      "max(48px, calc(var(--rep-stage) * 3))",
    );
    expect(declaration(tokensCss, "--rep-text-section")).toBe(
      "max(36px, calc(var(--rep-stage) * 2.1))",
    );
    expect(declaration(tokensCss, "--rep-text-body")).toBe(
      "max(28px, calc(var(--rep-stage) * 1.667))",
    );
    expect(declaration(tokensCss, "--rep-text-control")).toBe(
      "max(26px, calc(var(--rep-stage) * 1.35))",
    );
    expect(declaration(tokensCss, "--rep-text-caption")).toBe(
      "max(24px, calc(var(--rep-stage) * 1.25))",
    );
    expect(declaration(tokensCss, "--rep-text-mono")).toBe(
      "max(24px, calc(var(--rep-stage) * 1.25))",
    );
    expect(declaration(tokensCss, "--rep-text-badge")).toBe(
      "max(18px, calc(var(--rep-stage) * 1.1))",
    );
  });

  it("has no radius: depth is a hairline and one ink step", () => {
    expect(declaration(tokensCss, "--rep-radius")).toBe("0");
  });

  it("declares the motion vocabulary, and reduced motion keeps the fade", () => {
    // The two spring durations are provisional (design record §12): their
    // values may be tuned once, so the lock is their presence and the fade,
    // not the current milliseconds.
    expect(declaration(tokensCss, "--rep-motion-panel")).toMatch(/^\d+(\.\d+)?m?s$/);
    expect(declaration(tokensCss, "--rep-motion-quick")).toMatch(/^\d+(\.\d+)?m?s$/);
    expect(declaration(tokensCss, "--rep-motion-fade")).toMatch(/^\d+(\.\d+)?m?s$/);
    expect(declaration(tokensCss, "--rep-ease")).toBe("cubic-bezier(0.22, 1, 0.36, 1)");

    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? "";
    expect(reduced, "the sheet carries a reduced-motion block").not.toBe("");
    // Movement snaps; opacity and colour still fade (ADR-0031 §5).
    expect(reduced).toContain("--rep-motion-panel: 0ms;");
    expect(reduced).toContain("--rep-motion-quick: 0ms;");
    expect(reduced).not.toContain("--rep-motion-fade");
  });
});
