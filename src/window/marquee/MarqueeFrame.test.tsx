import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { markNavigation, markPointer } from "../../core/inputModality";
import { FADE_FALLBACK, panel } from "../../kit/marquee/motion";
import type { Destination, ShellLevel } from "../navigation";
import { CHROME_CLEARANCE } from "../reveal";
import {
  DESTINATION_FADE_SECONDS,
  FOLLOWING_ROWS_TOP_U,
  LEVEL_PUSH_PX,
  MARQUEE_RULES,
  POPOVER_RISE_PX,
  clampRowsScrollTop,
  destinationTransition,
  followingRowsViewportHeight,
  isSettingsLeaf,
  levelPushed,
  levelRises,
  marqueeUnitPx,
  rowsShiftTransition,
} from "./frame";
import { MarqueeFrame } from "./MarqueeFrame";
import marqueeCss from "./marquee.css?raw";

const LEGACY_PREFIX = ["-", "-rep-"].join("");

function declarationsOf(selector: string, css = marqueeCss): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function lengthInPx(value: string | undefined): number {
  const match = /^([\d.]+)(rem|px)$/.exec(value?.trim() ?? "");
  if (!match) {
    return Number.NaN;
  }
  return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
}

function FrameHarness() {
  const [destination, setDestination] = useState<Destination>("home");
  const [levels, setLevels] = useState<ShellLevel[]>([]);

  const choose = (next: Destination) => {
    setDestination(next);
    setLevels([]);
  };

  const back = () => {
    if (levels.length > 0) {
      setLevels((held) => held.slice(0, -1));
      return;
    }
    setDestination("home");
  };

  return (
    <MarqueeFrame
      destination={destination}
      onChooseDestination={choose}
      levels={levels}
      onBack={back}
      screen={
        <section
          data-testid={`content-${destination}`}
          data-region={`screen:${destination}`}
          data-kind="branch"
          data-label={destination}
        >
          <button type="button" data-focusable>
            Content
          </button>
        </section>
      }
    />
  );
}

function rail() {
  return screen.getByRole("navigation", { name: "Destinations" });
}

beforeEach(() => {
  markNavigation();
});

afterEach(() => {
  cleanup();
  markPointer();
});

describe("Marquee frame decisions (ADR-0032)", () => {
  test("cross-fades destinations in 240ms and snaps movement under reduced motion", () => {
    expect(DESTINATION_FADE_SECONDS).toBe(0.24);
    expect(destinationTransition()).toMatchObject({ duration: 0.24 });
    expect(rowsShiftTransition(false)).toEqual({ "--mq-rows-shift": panel() });
    expect(rowsShiftTransition(true)).toEqual({ "--mq-rows-shift": { duration: 0 } });
    expect(FADE_FALLBACK).toBe(0.14);
  });

  test("distinguishes pushed overlays, popovers, player takeovers and Settings leaves", () => {
    expect(levelPushed("overlay")).toBe(true);
    expect(levelPushed("player")).toBe(false);
    expect(levelPushed("popover")).toBe(false);
    expect(levelRises("popover")).toBe(true);
    expect(levelRises("overlay")).toBe(false);
    expect(LEVEL_PUSH_PX).toBe(24);
    expect(POPOVER_RISE_PX).toBeGreaterThanOrEqual(12);
    expect(POPOVER_RISE_PX).toBeLessThanOrEqual(16);
    expect(isSettingsLeaf({ id: "settings-credentials" })).toBe(true);
    expect(isSettingsLeaf({ id: "title" })).toBe(false);
    expect(isSettingsLeaf(null)).toBe(false);
    expect(MARQUEE_RULES).toMatchObject({
      railExit: "last",
      chromeExit: "hero",
      rowEntry: "first",
    });
  });

  test("clamps Home rows scroll against the settled 600u following viewport height", () => {
    expect(FOLLOWING_ROWS_TOP_U).toBe(480);
    expect(marqueeUnitPx(1920, 1080)).toBe(1);
    expect(marqueeUnitPx(1280, 720)).toBeCloseTo(2 / 3, 5);
    expect(marqueeUnitPx(800, 600)).toBe(0.5);

    // During rotating -> following, port.clientHeight is still 444u while the
    // settled following viewport is 1080 - 480 = 600u.
    const viewportHeight = followingRowsViewportHeight({
      hasHeroStage: true,
      homeHeight: 1080,
      portClientHeight: 444,
      unitPx: 1,
    });
    expect(viewportHeight).toBe(600);
    expect(
      clampRowsScrollTop({
        focusedRowId: "home-row:cinemeta:movie:top",
        rowOffsetTop: 367,
        scrollHeight: 840,
        viewportHeight,
      }),
    ).toBe(240);

    // Without a hero stage (or before layout), falls back to portClientHeight.
    expect(
      followingRowsViewportHeight({
        hasHeroStage: false,
        homeHeight: 1080,
        portClientHeight: 1080,
        unitPx: 1,
      }),
    ).toBe(1080);

    // Returning to rotating hero resets scrollTop to 0.
    expect(
      clampRowsScrollTop({
        focusedRowId: null,
        rowOffsetTop: 367,
        scrollHeight: 840,
        viewportHeight: 600,
      }),
    ).toBe(0);
  });
});

describe("Marquee frame and collapsible rail", () => {
  test("renders the six destinations in order with Home marked current", () => {
    render(<FrameHarness />);
    const nav = rail();
    const buttons = within(nav).getAllByRole("button");

    expect(buttons.map((button) => button.getAttribute("data-destination"))).toEqual([
      "home",
      "discover",
      "search",
      "library",
      "addons",
      "settings",
    ]);
    expect(within(nav).getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("choosing a destination switches the base, marks it current, and focuses it", async () => {
    render(<FrameHarness />);
    const discover = within(rail()).getByRole("button", { name: "Discover" });

    fireEvent.click(discover);

    expect(await screen.findByTestId("content-discover")).toBeInTheDocument();
    expect(discover).toHaveAttribute("aria-current", "page");
    expect(within(rail()).getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    await waitFor(() => expect(document.activeElement).toBe(discover));
  });

  test("Back from another destination returns to Home and focuses Home in the rail", async () => {
    render(<FrameHarness />);
    fireEvent.click(within(rail()).getByRole("button", { name: "Settings" }));
    await screen.findByTestId("content-settings");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByTestId("content-home")).toBeInTheDocument();
    const home = within(rail()).getByRole("button", { name: "Home" });
    expect(home).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(document.activeElement).toBe(home));
  });

  test("pointer focus keeps the rail collapsed; hover and navigation focus expand it", async () => {
    markPointer();
    render(<FrameHarness />);
    const nav = rail();
    const home = within(nav).getByRole("button", { name: "Home" });

    act(() => home.focus());
    await waitFor(() => expect(nav).toHaveAttribute("data-expanded", "false"));

    fireEvent.mouseEnter(nav);
    await waitFor(() => expect(nav).toHaveAttribute("data-expanded", "true"));

    fireEvent.mouseLeave(nav);
    await waitFor(() => expect(nav).toHaveAttribute("data-expanded", "false"));

    act(() => markNavigation());
    act(() => screen.getByRole("button", { name: "Content" }).focus());
    act(() => home.focus());
    await waitFor(() => expect(nav).toHaveAttribute("data-expanded", "true"));

    act(() => screen.getByRole("button", { name: "Content" }).focus());
    await waitFor(() => expect(nav).toHaveAttribute("data-expanded", "false"));
  });
});

function PushHarness() {
  const [levels, setLevels] = useState<ShellLevel[]>([]);
  return (
    <MarqueeFrame
      destination="home"
      onChooseDestination={() => {}}
      levels={levels}
      onBack={() => setLevels([])}
      screen={
        <button
          type="button"
          data-focusable
          onClick={() =>
            setLevels([
              {
                id: "pushed",
                name: "Pushed",
                kind: "overlay",
                payload: { render: () => <p>Inside</p> },
              },
            ])
          }
        >
          Open
        </button>
      }
    />
  );
}

function PlayerHarness() {
  const [levels, setLevels] = useState<ShellLevel[]>([]);
  return (
    <MarqueeFrame
      destination="home"
      onChooseDestination={() => {}}
      levels={levels}
      onBack={() => setLevels([])}
      screen={
        <button
          type="button"
          data-focusable
          onClick={() =>
            setLevels([
              {
                id: "selection",
                name: "Selection",
                kind: "overlay",
                payload: { render: () => <p>Selection</p> },
              },
              {
                id: "player",
                name: "Playing",
                kind: "player",
                payload: { render: () => <p>Player</p> },
              },
            ])
          }
        >
          Open
        </button>
      }
    />
  );
}

describe("Marquee levels and player takeover", () => {
  test("under reduced motion a pushed level arrives with a fade and no horizontal shift", async () => {
    render(
      <MotionConfig reducedMotion="always">
        <PushHarness />
      </MotionConfig>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const inside = await screen.findByText("Inside");
    const level = inside.closest("[data-level-id]");
    if (!(level instanceof HTMLElement)) {
      throw new Error("the pushed level did not mount");
    }

    await waitFor(() => expect(level.style.opacity).toBe("1"));
    expect(level.style.transform).not.toContain("translateX");
  });

  test("the level under the player stays mounted for Back and paints nothing", async () => {
    render(<PlayerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const selection = await screen.findByText("Selection");
    const level = selection.closest("[data-level-id]");
    if (!(level instanceof HTMLElement)) {
      throw new Error("the browsing level did not mount");
    }

    await waitFor(() => expect(level.style.opacity).toBe("0"));
    expect(level).toHaveAttribute("data-under-player", "true");
    expect(level).toHaveAttribute("aria-hidden", "true");
  });
});

describe("Marquee WindowChrome band lock (ADR-0032)", () => {
  test("keeps the 56px band and 4rem clearance that the D-pad geometry measures", () => {
    const root =
      marqueeCss.match(/\.mq-frame\s*\{[^}]*--window-chrome-height[^}]*\}/)?.[0] ?? "";
    const strip = declarationsOf(".mq-frame .shell-window-chrome");

    expect(strip).toMatch(/top:\s*0/);
    expect(strip).toMatch(/left:\s*0/);
    expect(strip).toMatch(/right:\s*0/);
    expect(strip).toMatch(/height:\s*var\(--window-chrome-height\)/);
    expect(strip).toMatch(/padding:\s*0\.5rem/);
    expect(root).toMatch(/--window-chrome-height:\s*56px/);
    expect(lengthInPx(root.match(/--window-chrome-height:\s*([^;]+)/)?.[1])).toBe(56);
    expect(root).toMatch(/--window-chrome-clearance:\s*4rem/);
    expect(lengthInPx(root.match(/--window-chrome-clearance:\s*([^;]+)/)?.[1])).toBe(
      CHROME_CLEARANCE,
    );
  });

  test("leaves the pointer through the strip to its button", () => {
    const strip = declarationsOf(".mq-frame .shell-window-chrome");
    const button = declarationsOf(".mq-frame .shell-window-chrome-button");

    expect(strip).toMatch(/pointer-events:\s*none/);
    expect(button).toMatch(/pointer-events:\s*auto/);
  });

  test("contains zero legacy tokens or literal lavender hexes", () => {
    expect(marqueeCss.trim().length).toBeGreaterThan(0);
    expect(marqueeCss.includes(LEGACY_PREFIX)).toBe(false);
    expect(marqueeCss).not.toMatch(/#c4a7e7/i);
  });
});
