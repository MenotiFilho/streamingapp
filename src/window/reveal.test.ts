import { afterEach, describe, expect, test, vi } from "vitest";

import type { Rect } from "./focus";
import {
  CHROME_CLEARANCE,
  REVEAL_MARGIN,
  centeredOffsets,
  focusAndReveal,
  onRevealed,
  reveal,
  revealIn,
  revealOffsets,
  scrollportsOf,
  type RevealScrollport,
} from "./reveal";

/**
 * A viewport 1000x600 at the origin. A 24px margin leaves the usable box at
 * x 24..976 and y 24..576; the numbers below are read from those two ranges.
 */
const viewport: Rect = { x: 0, y: 0, w: 1000, h: 600 };

/** A target that fits the usable box on both axes. */
const card: Rect = { x: 100, y: 100, w: 160, h: 240 };

describe("the reveal's geometry", () => {
  test("leaves a control that already clears the margin where it is", () => {
    expect(revealOffsets(viewport, card)).toEqual({ left: 0, top: 0 });
  });

  test("a control exactly at the margin needs no scroll", () => {
    expect(revealOffsets(viewport, { x: 24, y: 24, w: 952, h: 552 })).toEqual({
      left: 0,
      top: 0,
    });
  });

  test("scrolls down to a control below the fold", () => {
    // 500 + 240 = 740; the usable bottom is 576, so 164px of scroll.
    expect(revealOffsets(viewport, { x: 100, y: 500, w: 160, h: 240 })).toEqual({
      left: 0,
      top: 164,
    });
  });

  test("scrolls up to a control above the fold", () => {
    // -100 against the usable top of 24: 124px up, instant.
    expect(revealOffsets(viewport, { x: 100, y: -100, w: 160, h: 240 })).toEqual({
      left: 0,
      top: -124,
    });
  });

  test("scrolls right to the end of a row", () => {
    // 900 + 160 = 1060; the usable right is 976, so 84px.
    expect(revealOffsets(viewport, { x: 900, y: 100, w: 160, h: 240 })).toEqual({
      left: 84,
      top: 0,
    });
  });

  test("scrolls left to a control the row left behind", () => {
    expect(revealOffsets(viewport, { x: -60, y: 100, w: 160, h: 240 })).toEqual({
      left: -84,
      top: 0,
    });
  });

  test("aligns the start of a control taller than the scrollport", () => {
    // 700px is taller than the 552px usable height: the head is what a person
    // needs, so the offset is against the top even though the end overflows.
    expect(revealOffsets(viewport, { x: 100, y: -40, w: 160, h: 700 })).toEqual({
      left: 0,
      top: -64,
    });
  });

  test("aligns the start of a control wider than the scrollport", () => {
    expect(revealOffsets(viewport, { x: -100, y: 100, w: 1200, h: 240 })).toEqual({
      left: -124,
      top: 0,
    });
  });

  test("starts the usable box at the fixed chrome's clearance", () => {
    // 70 is clear of the viewport's own edge but under the 64px chrome band;
    // with the chrome inset the usable top is 88, so the reveal scrolls up 18.
    expect(
      revealOffsets(
        viewport,
        { x: 100, y: 70, w: 160, h: 100 },
        REVEAL_MARGIN,
        CHROME_CLEARANCE,
      ),
    ).toEqual({ left: 0, top: -18 });
  });

  test("a scrollport with no chrome keeps the same control where it is", () => {
    expect(revealOffsets(viewport, { x: 100, y: 70, w: 160, h: 100 })).toEqual({
      left: 0,
      top: 0,
    });
  });

  test("the margin is exactly 24px", () => {
    expect(REVEAL_MARGIN).toBe(24);
  });

  test("the chrome clearance is the shell's 64px content top", () => {
    expect(CHROME_CLEARANCE).toBe(64);
  });
});

describe("the repertory centre", () => {
  test("centres a focused card on both axes", () => {
    // The usable box is x 24..976 (centre 500) and y 24..576 (centre 300).
    // A card centred at (500, 620) needs 320px of downward page scroll.
    expect(centeredOffsets(viewport, { x: 420, y: 500, w: 160, h: 240 })).toEqual({
      left: 0,
      top: 320,
    });
  });

  test("centres a card the row left behind", () => {
    // A card centred at 180 in a 500-wide usable middle moves left 320.
    expect(centeredOffsets(viewport, { x: 100, y: 180, w: 160, h: 240 })).toEqual({
      left: -320,
      top: 0,
    });
  });

  test("aligns the start of a card taller than the scrollport", () => {
    expect(centeredOffsets(viewport, { x: 420, y: -40, w: 160, h: 700 })).toEqual({
      left: 0,
      top: -64,
    });
  });

  test("moves a scroller by the centre, not by the edge", () => {
    const fake = nested();
    revealIn(fake.target, [fake.row, fake.page], "center");

    // The row's visible middle is 400; the card's middle at 840 moves it 440.
    // The page's visible middle is 200; the card's middle at 620 moves it 420.
    expect(fake.scrolled).toEqual({ row: 440, page: 420 });
  });
});

/** A target whose client rect follows the fakes' scroll offsets. */
type Fake = {
  scrolled: { row: number; page: number };
  target: { getBoundingClientRect: () => DOMRect };
  row: RevealScrollport;
  page: RevealScrollport;
};

/**
 * A row inside a page: the card starts at x 760 (past the row's right edge)
 * and y 500 (past the page's bottom), and both fakes move their target the way
 * a real scrollport would.
 */
function nested(): Fake {
  const scrolled = { row: 0, page: 0 };
  return {
    scrolled,
    target: {
      getBoundingClientRect: () =>
        ({ left: 760 - scrolled.row, top: 500 - scrolled.page, width: 160, height: 240 }) as DOMRect,
    },
    row: {
      // 100..700 by 0..800: the card fits vertically, so only x moves here.
      visible: () => ({ x: 100, y: 0, w: 600, h: 800 }),
      insetTop: 0,
      moves: true,
      scrollBy: (left) => {
        scrolled.row += left;
      },
    },
    page: {
      visible: () => ({ x: 0, y: 0, w: 1000, h: 400 }),
      insetTop: 0,
      moves: true,
      scrollBy: (_left, top) => {
        scrolled.page += top;
      },
    },
  };
}

describe("the reveal's DOM loop", () => {
  test("moves nested scrollers innermost first, each by its own minimum", () => {
    const fake = nested();
    revealIn(fake.target, [fake.row, fake.page]);

    // The row's usable right is 676: the card's right 920 moves it 244. Then
    // the page's usable bottom is 376: 740 moves it 364.
    expect(fake.scrolled).toEqual({ row: 244, page: 364 });
    // Recomputing the rect after the row moved is what leaves 24px on the
    // right and nothing extra: the page then finds the card already in range.
    const settled = fake.target.getBoundingClientRect();
    expect(settled.left).toBe(516);
    expect(settled.top).toBe(136);
  });

  test("a scroller the fixed chrome cannot move is left alone", () => {
    const fake = nested();
    fake.page.moves = false;
    revealIn(fake.target, [fake.row, fake.page]);

    expect(fake.scrolled).toEqual({ row: 244, page: 0 });
  });

  test("a zero-size scrollport is skipped instead of scrolling by a blind delta", () => {
    const scrollBy = vi.fn();
    const target = { getBoundingClientRect: () => ({ left: 40, top: 40, width: 100, height: 100 }) as DOMRect };
    revealIn(target, [
      { visible: () => ({ x: 0, y: 0, w: 0, h: 0 }), insetTop: 0, moves: true, scrollBy },
    ]);

    expect(scrollBy).not.toHaveBeenCalled();
  });

  test("the chrome inset is applied to the page, and not to a scroller without it", () => {
    const withChrome = {
      top: 0,
      scrolled: false,
      port: (): RevealScrollport => ({
        visible: () => ({ x: 0, y: 0, w: 1000, h: 600 }),
        insetTop: CHROME_CLEARANCE,
        moves: true,
        scrollBy: (_left, top) => {
          withChrome.top += top;
          withChrome.scrolled = true;
        },
      }),
    };
    const target = { getBoundingClientRect: () => ({ left: 100, top: 70, width: 160, height: 100 }) as DOMRect };

    revealIn(target, [withChrome.port()]);
    expect(withChrome.scrolled).toBe(true);
    expect(withChrome.top).toBe(-18);

    const bare = { scrolled: false };
    revealIn(target, [
      {
        visible: () => ({ x: 0, y: 0, w: 1000, h: 600 }),
        insetTop: 0,
        moves: true,
        scrollBy: () => {
          bare.scrolled = true;
        },
      },
    ]);
    expect(bare.scrolled).toBe(false);
  });
});

/** A card inside a row inside a level, with the scroll behaviour set in CSS. */
function shellTree(levelKind: string | null = "overlay", chrome = true) {
  const card = document.createElement("button");
  const row = document.createElement("div");
  row.style.overflowX = "auto";
  row.append(card);
  const level = document.createElement("div");
  level.className = "shell-level";
  if (levelKind) {
    level.dataset.levelKind = levelKind;
  }
  level.style.overflowY = "auto";
  level.append(row);
  if (chrome) {
    const strip = document.createElement("div");
    strip.className = "shell-window-chrome";
    level.append(strip);
  }
  document.body.append(level);
  return { card, row, level };
}

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.scrollTop = 0;
  vi.restoreAllMocks();
  Reflect.deleteProperty(document.documentElement, "clientWidth");
  Reflect.deleteProperty(document.documentElement, "clientHeight");
});

describe("the scrollport chain", () => {
  test("walks the scrollable ancestors innermost first and ends at the window", () => {
    const { card } = shellTree();
    const ports = scrollportsOf(card);

    expect(ports, "the row, the level, then the window").toHaveLength(3);
    expect(ports.map((port) => port.insetTop)).toEqual([
      0,
      CHROME_CLEARANCE,
      CHROME_CLEARANCE,
    ]);
  });

  test("a popover or player level has no chrome band to clear", () => {
    const { card } = shellTree("popover", false);
    expect(scrollportsOf(card).map((port) => port.insetTop)).toEqual([0, 0, 0]);

    document.body.innerHTML = "";
    const player = shellTree("player", false);
    expect(scrollportsOf(player.card).map((port) => port.insetTop)).toEqual([0, 0, 0]);
  });

  test("the base screen clears the chrome it draws", () => {
    const { card, level } = shellTree(null);
    level.className = "shell-base";
    expect(scrollportsOf(card)[1]?.insetTop).toBe(CHROME_CLEARANCE);
  });

  test("a scroller outside the shell has no chrome", () => {
    const card = document.createElement("button");
    const menu = document.createElement("div");
    menu.className = "kit-popover";
    menu.style.overflowY = "auto";
    menu.append(card);
    document.body.append(menu);

    expect(scrollportsOf(card).map((port) => port.insetTop)).toEqual([0, 0]);
  });

  test("the window's visible box is the viewport, not the root's scrolled rect", () => {
    const { card } = shellTree();
    vi.spyOn(document.documentElement, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: -500,
      width: 1000,
      height: 2000,
      top: -500,
      left: 0,
      right: 1000,
      bottom: 1500,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 600,
    });

    const page = scrollportsOf(card).at(-1);
    expect(page?.visible(), "a scrolled page still shows the viewport at 0..600").toEqual({
      x: 0,
      y: 0,
      w: 1000,
      h: 600,
    });
  });

  test("the window port scrolls the base screen and applies the chrome inset", () => {
    const base = document.createElement("div");
    base.className = "shell-base";
    const card = document.createElement("button");
    const strip = document.createElement("div");
    strip.className = "shell-window-chrome";
    base.append(card, strip);
    document.body.append(base);

    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 700,
      width: 160,
      height: 200,
      top: 700,
      left: 100,
      right: 260,
      bottom: 900,
      toJSON: () => ({}),
    } as DOMRect);
    Object.defineProperty(document.documentElement, "clientWidth", {
      configurable: true,
      value: 1000,
    });
    Object.defineProperty(document.documentElement, "clientHeight", {
      configurable: true,
      value: 600,
    });

    reveal(card);
    // The usable bottom is 600 - 24 = 576, so 900 needs 324px of page scroll.
    // The chrome inset only narrows the top, and this control is below it.
    expect(document.documentElement.scrollTop).toBe(324);
  });

  test("a control under a fixed panel is not moved by the page or the level", () => {
    const { card, row, level } = shellTree();
    const fixed = document.createElement("div");
    fixed.style.position = "fixed";
    fixed.append(row);
    level.append(fixed);

    const ports = scrollportsOf(card);
    expect(ports[0]?.moves, "the menu inside the panel still scrolls").toBe(true);
    expect(ports[1]?.moves, "the level cannot move a fixed panel").toBe(false);
    expect(ports[2]?.moves, "the page cannot either").toBe(false);
  });
});

/**
 * A control below a 1000x600 viewport. Revealing it would scroll the page 324px
 * (700 + 200 - (600 - 24)), so a refused focus that still revealed would be
 * visible as a jolt of that size.
 */
function belowTheFold(control: HTMLElement): void {
  vi.spyOn(control, "getBoundingClientRect").mockReturnValue({
    x: 100,
    y: 700,
    width: 160,
    height: 200,
    top: 700,
    left: 100,
    right: 260,
    bottom: 900,
    toJSON: () => ({}),
  } as DOMRect);
  Object.defineProperty(document.documentElement, "clientWidth", {
    configurable: true,
    value: 1000,
  });
  Object.defineProperty(document.documentElement, "clientHeight", {
    configurable: true,
    value: 600,
  });
}

describe("the reveal after a focus attempt", () => {
  test("a successful focus reveals the control", () => {
    const control = document.createElement("button");
    document.body.append(control);
    belowTheFold(control);

    focusAndReveal(control);

    expect(document.activeElement).toBe(control);
    expect(document.documentElement.scrollTop).toBe(324);
  });

  test("a disabled control leaves focus and the page where they were", () => {
    const other = document.createElement("button");
    const control = document.createElement("button");
    control.disabled = true;
    document.body.append(other, control);
    belowTheFold(control);
    other.focus();

    focusAndReveal(control);

    expect(document.activeElement, "a disabled control cannot take focus").toBe(other);
    expect(document.documentElement.scrollTop, "a refused focus must not scroll").toBe(0);
  });

  test("a detached control is not revealed", () => {
    const control = document.createElement("button");
    belowTheFold(control);
    // jsdom focuses a detached element where a browser would not; the reveal
    // must still refuse the connection-less control's 0x0 rectangle.
    control.focus();

    focusAndReveal(control);

    expect(
      document.documentElement.scrollTop,
      "a detached control has nowhere to be shown",
    ).toBe(0);
  });

  test("focus landing elsewhere does not move the page", () => {
    const other = document.createElement("button");
    const control = document.createElement("button");
    document.body.append(other, control);
    belowTheFold(control);
    // A focus trap, an inert ancestor or the browser's own refusal can send
    // the focus this call asked for somewhere else.
    vi.spyOn(control, "focus").mockImplementation(() => other.focus());

    focusAndReveal(control);

    expect(document.activeElement).toBe(other);
    expect(document.documentElement.scrollTop).toBe(0);
  });

  test("a successful direct reveal is reported once, and a refused one not at all", () => {
    const seen = vi.fn();
    const stop = onRevealed(seen);
    const control = document.createElement("button");
    const disabled = document.createElement("button");
    disabled.disabled = true;
    document.body.append(control, disabled);
    belowTheFold(control);
    belowTheFold(disabled);

    try {
      focusAndReveal(disabled);
      expect(seen, "the engine must not guard a reveal that never ran").not.toHaveBeenCalled();

      focusAndReveal(control);
      expect(seen).toHaveBeenCalledTimes(1);
      expect(seen).toHaveBeenCalledWith(control);
    } finally {
      stop();
    }
  });

  test("a wrapper that passes focus to a child reveals the child", () => {
    const wrapper = document.createElement("div");
    const child = document.createElement("button");
    wrapper.append(child);
    document.body.append(wrapper);
    belowTheFold(child);
    // A wrapper is not focusable itself; its focus delegating to the control
    // inside is how a screen marker or a composite lands focus.
    vi.spyOn(wrapper, "focus").mockImplementation(() => child.focus());

    focusAndReveal(wrapper);

    expect(document.activeElement).toBe(child);
    expect(
      document.documentElement.scrollTop,
      "the reveal follows the element that holds focus, not the wrapper's empty box",
    ).toBe(324);
  });

  test("a parked reveal is not replayed after its control lost focus", () => {
    const control = document.createElement("button");
    const other = document.createElement("button");
    document.body.append(control, other);

    // No subscriber yet, so the reveal is parked for the engine that binds
    // later — the mount case. Focus then moves on before the engine arrives.
    focusAndReveal(control);
    other.focus();

    const seen = vi.fn();
    const stop = onRevealed(seen);
    try {
      expect(
        seen,
        "a control that no longer holds focus must not seed the engine's guard",
      ).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  });
});
