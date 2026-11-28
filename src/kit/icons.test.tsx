import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ICON_NAMES, ICON_WEIGHTS, Icon, iconPaths, type IconName, type IconWeight } from "./icons";

/**
 * Every icon name declared in `docs/design/marquee/scripts/build.js`'s `PH` map
 * (55 names covering every C0 glyph and `docs/design-system.md` §7).
 */
const EXPECTED_ICON_NAMES: readonly IconName[] = [
  "house",
  "compass",
  "search",
  "library",
  "puzzle",
  "settings",
  "play",
  "pause",
  "info",
  "arrow-left",
  "x",
  "list-video",
  "check",
  "triangle-alert",
  "captions",
  "audio-lines",
  "gauge",
  "chapters",
  "maximize",
  "volume-2",
  "rotate-ccw",
  "rotate-cw",
  "skip-forward",
  "sliders-horizontal",
  "users",
  "disk",
  "globe",
  "picture",
  "caret-right",
  "plus",
  "bookmark",
  "film",
  "arrow-clockwise",
  "wifi-x",
  "device",
  "skip-back",
  "stop",
  "caret-down",
  "signal",
  "wifi",
  "battery",
  "episodes",
  "mute",
  "host",
  "download",
  "key",
  "arrow-up",
  "arrow-down",
  "trash",
  "handle",
  "minus-circle",
  "ring",
  "notch",
  "stats",
  "minus",
];

/**
 * Every (name, weight) combination rendered on mockup sheet `C0 Icons` (`C0.jpg`).
 */
const C0_SHEET_VARIANTS: readonly [IconName, IconWeight][] = [
  ["play", "fill"],
  ["check", "bold"],
  ["house", "regular"],
  ["house", "fill"],
  ["compass", "regular"],
  ["search", "regular"],
  ["library", "regular"],
  ["puzzle", "regular"],
  ["settings", "regular"],
  ["compass", "fill"],
  ["info", "regular"],
  ["x", "regular"],
  ["users", "regular"],
  ["disk", "regular"],
  ["globe", "regular"],
  ["triangle-alert", "regular"],
  ["arrow-clockwise", "regular"],
  ["arrow-left", "regular"],
  ["volume-2", "regular"],
  ["rotate-ccw", "regular"],
  ["pause", "fill"],
  ["rotate-cw", "regular"],
  ["skip-forward", "fill"],
  ["picture", "regular"],
  ["captions", "regular"],
  ["list-video", "regular"],
  ["episodes", "regular"],
  ["gauge", "regular"],
  ["chapters", "regular"],
  ["stats", "regular"],
  ["maximize", "regular"],
  ["minus", "regular"],
  ["plus", "regular"],
  ["stop", "fill"],
  ["caret-right", "regular"],
  ["arrow-up", "regular"],
  ["arrow-down", "regular"],
  ["trash", "regular"],
  ["handle", "regular"],
  ["caret-down", "regular"],
  ["film", "regular"],
  ["device", "regular"],
  ["signal", "fill"],
  ["wifi", "fill"],
  ["battery", "fill"],
  ["search", "fill"],
  ["library", "fill"],
  ["puzzle", "fill"],
  ["settings", "fill"],
  ["skip-back", "fill"],
  ["audio-lines", "regular"],
  ["sliders-horizontal", "regular"],
  ["skip-forward", "regular"],
  ["play", "regular"],
  ["minus-circle", "fill"],
  ["key", "regular"],
];

describe("Marquee C0 Phosphor icon registry", () => {
  it("contains every icon name from build.js PH with no duplicates", () => {
    expect([...ICON_NAMES].sort()).toEqual([...EXPECTED_ICON_NAMES].sort());
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it("resolves valid SVG path geometry for every icon name across regular, fill and bold", () => {
    for (const name of ICON_NAMES) {
      for (const weight of ICON_WEIGHTS) {
        const paths = iconPaths(name, weight);
        expect(paths.length, `${name}:${weight} has at least one path`).toBeGreaterThan(0);
        for (const d of paths) {
          expect(d, `${name}:${weight} path begins with an SVG move command`).toMatch(/^[Mm]\s*-?\d/);
          expect(d).not.toContain("<");
        }
      }
    }
  });

  it("covers all 56 C0 sheet variants and distinguishes weights", () => {
    expect(C0_SHEET_VARIANTS).toHaveLength(56);
    for (const [name, weight] of C0_SHEET_VARIANTS) {
      expect(iconPaths(name, weight).length).toBeGreaterThan(0);
    }

    expect(iconPaths("house", "regular")).not.toEqual(iconPaths("house", "fill"));
    expect(iconPaths("check", "regular")).not.toEqual(iconPaths("check", "bold"));
    // Multi-path Phosphor asset (`stack-fill.svg`) keeps every layer path.
    expect(iconPaths("episodes", "fill")).toHaveLength(3);
  });
});

describe("Icon component contract", () => {
  it("renders decorative icons as aria-hidden 24x24 SVGs on Phosphor's 256 grid", () => {
    const { container } = render(<Icon name="play" weight="fill" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("viewBox", "0 0 256 256");
    expect(svg).toHaveAttribute("width", "24");
    expect(svg).toHaveAttribute("height", "24");
    expect(svg).toHaveAttribute("fill", "currentColor");
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(svg).not.toHaveAttribute("role");
  });

  it("exposes role='img' and aria-label when labelled", () => {
    render(<Icon name="check" weight="bold" label="Watched" />);
    const img = screen.getByRole("img", { name: "Watched" });
    expect(img).not.toHaveAttribute("aria-hidden");
  });

  it("supports explicit pixel sizes, CSS length sizes and multi-path glyphs", () => {
    const { container, rerender } = render(<Icon name="episodes" weight="fill" size={32} />);
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("width", "32");
    expect(svg).toHaveAttribute("height", "32");
    expect(svg?.querySelectorAll("path")).toHaveLength(3);

    rerender(<Icon name="house" size="calc(var(--mq-u) * 26)" />);
    expect(svg?.style.width).toBe("calc(var(--mq-u) * 26)");
    expect(svg?.style.height).toBe("calc(var(--mq-u) * 26)");
  });
});
