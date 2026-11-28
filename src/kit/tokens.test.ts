import { describe, expect, it } from "vitest";

import {
  compositeOver,
  contrastRatio,
  parseHex,
  readDeclaration,
  readHexToken,
  readNumberToken,
} from "./contrast";
import baseCss from "./base.css?raw";
import tokensCss from "./tokens.css?raw";

const canvas = readHexToken(tokensCss, "--mq-canvas");
const surface = readHexToken(tokensCss, "--mq-surface");
const surface2 = readHexToken(tokensCss, "--mq-surface-2");
const surface3 = readHexToken(tokensCss, "--mq-surface-3");
const white = readHexToken(tokensCss, "--mq-white");
const accent = readHexToken(tokensCss, "--mq-accent");
const imdb = readHexToken(tokensCss, "--mq-imdb");
const ok = readHexToken(tokensCss, "--mq-ok");
const warn = readHexToken(tokensCss, "--mq-warn");
const danger = readHexToken(tokensCss, "--mq-danger");

const alphaMuted = readNumberToken(tokensCss, "--mq-alpha-muted");
const alphaFaint = readNumberToken(tokensCss, "--mq-alpha-faint");
const alphaLine = readNumberToken(tokensCss, "--mq-alpha-line");
const alphaGlass = readNumberToken(tokensCss, "--mq-alpha-glass");

/** Assembled so this test never writes the legacy prefix verbatim in its source. */
const LEGACY_PREFIX = ["-", "-rep-"].join("");

describe("contrast math", () => {
  it("computes standard WCAG endpoints and sRGB alpha compositing", () => {
    expect(contrastRatio("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
    expect(parseHex("#fff")).toEqual({ r: 1, g: 1, b: 1 });
    expect(compositeOver("#FFFFFF", "#000000", 0.5)).toEqual({ r: 0.5, g: 0.5, b: 0.5 });
    expect(() => compositeOver("#FFFFFF", "#000000", 1.5)).toThrow();
  });
});

describe("the Marquee palette contrast lock (docs/design-system.md §2)", () => {
  it("declares all ten palette colours and four alpha steps", () => {
    for (const hex of [canvas, surface, surface2, surface3, white, accent, imdb, ok, warn, danger]) {
      expect(hex).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
    expect(alphaMuted).toBe(0.72);
    expect(alphaFaint).toBe(0.5);
    expect(alphaLine).toBe(0.12);
    expect(alphaGlass).toBe(0.14);
  });

  it("clears WCAG AA (4.5:1) for every measured foreground/background pair in §2", () => {
    const mutedOnCanvas = compositeOver(white, canvas, alphaMuted);
    const faintOnCanvas = compositeOver(white, canvas, alphaFaint);
    const faintOnSurface = compositeOver(white, surface, alphaFaint);
    const glassOnCanvas = compositeOver(white, canvas, alphaGlass);

    // Every pair listed in `docs/design-system.md` §2, read straight from tokens.css.
    expect(contrastRatio(white, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(white, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mutedOnCanvas, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(faintOnCanvas, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(faintOnSurface, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(accent, surface)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(canvas, accent)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(canvas, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(white, glassOnCanvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(danger, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ok, canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(canvas, imdb)).toBeGreaterThanOrEqual(4.5);
  });

  it("matches the documented §2 ratios for the locked values", () => {
    const round1 = (value: number) => Math.round(value * 10) / 10;

    expect(round1(contrastRatio(white, canvas))).toBe(19.7);
    expect(round1(contrastRatio(white, surface))).toBe(18.1);
    expect(round1(contrastRatio(compositeOver(white, canvas, alphaMuted), canvas))).toBe(10.2);
    expect(round1(contrastRatio(compositeOver(white, canvas, alphaFaint), canvas))).toBe(5.3);
    expect(round1(contrastRatio(compositeOver(white, surface, alphaFaint), surface))).toBe(5.3);
    expect(round1(contrastRatio(accent, canvas))).toBe(9.4);
    expect(round1(contrastRatio(accent, surface))).toBe(8.6);
    expect(round1(contrastRatio(canvas, accent))).toBe(9.4);
    expect(round1(contrastRatio(canvas, white))).toBe(19.7);
    expect(round1(contrastRatio(white, compositeOver(white, canvas, alphaGlass)))).toBe(13.7);
    expect(round1(contrastRatio(danger, canvas))).toBe(6.5);
    expect(round1(contrastRatio(ok, canvas))).toBe(10.5);
    expect(round1(contrastRatio(canvas, imdb))).toBe(12.1);
  });

  it("keeps white text off lavender and IMDb yellow fills (ink is required)", () => {
    // Both fills are bright enough that white fails even large-text 3:1;
    // primary actions and IMDb badges must carry ink (`--mq-canvas`).
    expect(contrastRatio(white, accent)).toBeLessThan(3);
    expect(contrastRatio(white, imdb)).toBeLessThan(3);
  });
});

describe("Marquee token hygiene", () => {
  it("declares lavender once: no hex or rgb lavender literal outside --mq-accent", () => {
    const lavender = /196[\s,]+167[\s,]+231|#c4a7e7/i;
    const allowed = /^\s*--mq-accent\s*:/;
    // The kit's sheets and both clients': one correction moves everything.
    const sheets = Object.entries(
      import.meta.glob<string>(["./**/*.css", "../window/**/*.css", "../remote/**/*.css"], {
        eager: true,
        query: "?raw",
        import: "default",
      }),
    );

    expect(sheets.map(([name]) => name)).toContain("../window/marquee/marquee.css");
    for (const [name, css] of sheets) {
      expect(css.trim().length, `${name} must load as non-empty CSS text`).toBeGreaterThan(0);
      const offenders = css
        .split("\n")
        .filter((line) => lavender.test(line) && !allowed.test(line));
      expect(offenders, `${name} repeats lavender outside --mq-accent`).toEqual([]);
    }
  });

  it("contains zero legacy token aliases or references in the kit or either client", () => {
    const files = Object.entries(
      import.meta.glob<string>(
        ["./**/*.{css,ts,tsx}", "../window/**/*.{css,ts,tsx}", "../remote/**/*.{css,ts,tsx}"],
        {
          eager: true,
          query: "?raw",
          import: "default",
        },
      ),
    );

    expect(files.length).toBeGreaterThan(0);
    for (const [name, source] of files) {
      expect(source.includes(LEGACY_PREFIX), `${name} must not reference legacy tokens`).toBe(
        false,
      );
    }
  });

  it("loads only local Figtree faces from /fonts/ with zero third-party URLs", () => {
    expect(tokensCss).toContain('url("/fonts/figtree-latin-wght-normal.woff2")');
    expect(tokensCss).not.toMatch(/url\(\s*["']?https?:\/\//i);
  });

  it("scopes base utility rules under .mq-root, so no bare element rule leaks", () => {
    expect(baseCss).toContain(".mq-root");
    expect(baseCss).toContain('html[data-input="pointer"]');
    expect(baseCss).toContain('html[data-input="navigation"]');
    // Never style bare `body {` or bare `[data-focusable]` outside `.mq-root`.
    expect(baseCss).not.toMatch(/^\s*body\s*\{/m);
    expect(baseCss).not.toMatch(/^\s*\[data-focusable\]/m);
  });
});

describe("the reference-frame scaling unit, radii, depth and motion lock", () => {
  it("defines --mq-u for the 1920x1080 reference frame with a floor and no ceiling", () => {
    const unit = readDeclaration(tokensCss, "--mq-u");
    expect(unit).toBe("max(0.5px, calc(min(1vw, 1.7777778vh) / 19.2))");
  });

  it("declares the focus scale factors for poster, wide and episode cards", () => {
    expect(readNumberToken(tokensCss, "--mq-scale-poster")).toBe(1.08);
    expect(readNumberToken(tokensCss, "--mq-scale-wide")).toBe(1.07);
    expect(readNumberToken(tokensCss, "--mq-scale-episode")).toBe(1.06);
  });

  it("declares the documented radii and glass blur tokens", () => {
    for (const radius of ["6", "8", "10", "12", "14", "16", "18", "20", "24", "28"]) {
      expect(readDeclaration(tokensCss, `--mq-radius-${radius}`)).toBe(
        `calc(var(--mq-u) * ${radius})`,
      );
    }
    expect(readDeclaration(tokensCss, "--mq-radius-full")).toBe("9999px");
    expect(readDeclaration(tokensCss, "--mq-blur-panel")).toBe("50px");
    expect(readDeclaration(tokensCss, "--mq-blur-side")).toBe("60px");
  });

  it("declares the ADR-0031 motion vocabulary and keeps fade under reduced motion", () => {
    expect(readDeclaration(tokensCss, "--mq-motion-panel")).toBe("240ms");
    expect(readDeclaration(tokensCss, "--mq-motion-quick")).toBe("140ms");
    expect(readDeclaration(tokensCss, "--mq-motion-fade")).toBe("140ms");
    expect(readDeclaration(tokensCss, "--mq-ease")).toBe("cubic-bezier(0.22, 1, 0.36, 1)");

    const reduced =
      /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(tokensCss)?.[1] ?? "";
    expect(reduced, "tokens.css declares a reduced-motion block").not.toBe("");
    // Movement snaps; opacity and colour still fade (ADR-0031 §5).
    expect(reduced).toContain("--mq-motion-panel: 0ms;");
    expect(reduced).toContain("--mq-motion-quick: 0ms;");
    expect(reduced).not.toContain("--mq-motion-fade");
  });
});
