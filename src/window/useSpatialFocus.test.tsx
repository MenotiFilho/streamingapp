import { fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { inputModality, markNavigation, markPointer } from "../core/inputModality";
import { installPointerPress } from "../core/react/pointerPress";
import { DEFAULT_RULES } from "./focus";
import { focusAndReveal } from "./reveal";
import { useSpatialFocus } from "./useSpatialFocus";

/**
 * jsdom has no layout. The track is 600px wide and the second card starts at
 * x 700, so a Right press has to move the row 284px (700 + 160 - (600 - 24)).
 * The cards' client rects follow the track's scrollLeft, as a real browser's
 * would, so a Left press afterwards has to bring the first card back.
 *
 * The client boxes are read off the prototype so a control focused from a
 * child's mount effect is already measured when the engine's effects run.
 */
function layOutRow() {
  const measured = { row: 0 };
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      const key =
        this.dataset.testid === "track" ? "row" : (this.dataset.testid ?? this.dataset.region);
      if (key === "row") {
        measured.row += 1;
      }
      const scrolled =
        document.querySelector<HTMLElement>('[data-testid="track"]')?.scrollLeft ?? 0;
      const boxes: Record<string, [number, number, number, number]> = {
        screen: [0, 0, 600, 600],
        row: [0, 100, 600, 300],
        one: [40, 120, 160, 240],
        two: [700, 120, 160, 240],
      };
      const [x, y, w, h] = boxes[key ?? ""] ?? [0, 0, 0, 0];
      const left = key === "one" || key === "two" ? x - scrolled : x;
      return {
        x: left,
        y,
        width: w,
        height: h,
        left,
        top: y,
        right: left + w,
        bottom: y + h,
        toJSON: () => ({}),
      } as DOMRect;
    });
  const clientWidth = vi
    .spyOn(Element.prototype, "clientWidth", "get")
    .mockImplementation(function (this: Element) {
      if (this === document.documentElement) {
        return 1000;
      }
      return this.getAttribute("data-testid") === "track" ? 600 : 0;
    });
  const clientHeight = vi
    .spyOn(Element.prototype, "clientHeight", "get")
    .mockImplementation(function (this: Element) {
      if (this === document.documentElement) {
        return 600;
      }
      return this.getAttribute("data-testid") === "track" ? 300 : 0;
    });
  return { measured, rect, clientWidth, clientHeight };
}

function DirectFocus() {
  useEffect(() => {
    focusAndReveal(document.querySelector<HTMLElement>('[data-testid="two"]'));
  }, []);
  return null;
}

function Harness({
  direct = false,
  auto = false,
  inertFirst = false,
  onActivate,
}: {
  direct?: boolean;
  auto?: boolean;
  inertFirst?: boolean;
  onActivate?: () => void;
}) {
  const root = useRef<HTMLDivElement | null>(null);
  useSpatialFocus({
    root: () => root.current,
    levelKey: "reveal-test",
    onBack: () => {},
  });

  return (
    <div ref={root} data-region="screen" data-kind="branch" data-label="the screen">
      {direct ? <DirectFocus /> : null}
      <div
        className="kit-row-track"
        data-region="row"
        data-kind="row"
        data-label="the row"
        data-testid="track"
        style={{ overflowX: "auto" }}
      >
        <button data-focusable data-testid="one" inert={inertFirst ? true : undefined}>
          One
        </button>
        <button data-focusable data-testid="two" autoFocus={auto} onClick={onActivate}>
          Two
        </button>
      </div>
    </div>
  );
}

/**
 * The frame's shape: a rail at the left, a feature above a row. The
 * feature is the first content control, so it is what a rail with no history
 * would enter; the row card is what a return has to remember.
 */
function layOutSpine() {
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      const key = this.dataset.testid ?? this.dataset.region;
      const boxes: Record<string, [number, number, number, number]> = {
        screen: [0, 0, 1000, 600],
        rail: [0, 0, 100, 600],
        "rail-home": [0, 0, 100, 60],
        "rail-settings": [0, 80, 100, 60],
        content: [200, 0, 760, 600],
        hero: [200, 0, 760, 80],
        row: [200, 120, 600, 240],
        one: [200, 120, 160, 240],
        two: [380, 120, 160, 240],
      };
      const [x, y, w, h] = boxes[key ?? ""] ?? [0, 0, 0, 0];
      return {
        x,
        y,
        width: w,
        height: h,
        left: x,
        top: y,
        right: x + w,
        bottom: y + h,
        toJSON: () => ({}),
      } as DOMRect;
    });
  return { rect };
}

function SpineHarness() {
  const root = useRef<HTMLDivElement | null>(null);
  useSpatialFocus({
    root: () => root.current,
    levelKey: "rail-return-test",
    onBack: () => {},
    rules: { ...DEFAULT_RULES, railExit: "last" },
  });

  return (
    <div ref={root} data-region="screen" data-kind="branch" data-label="the screen">
      <nav data-region="rail" data-kind="rail" data-label="the rail">
        <button data-focusable data-testid="rail-home">
          Home
        </button>
        <button data-focusable data-testid="rail-settings">
          Settings
        </button>
      </nav>
      <div data-region="content" data-kind="branch" data-label="the content">
        <div data-region="hero" data-kind="branch" data-label="the feature">
          <button data-focusable data-testid="hero">
            Hero
          </button>
        </div>
        <div data-region="row" data-kind="row" data-label="the row">
          <button data-focusable data-testid="one">
            One
          </button>
          <button data-focusable data-testid="two">
            Two
          </button>
        </div>
      </div>
    </div>
  );
}

afterEach(() => {
  markPointer();
  vi.restoreAllMocks();
});

beforeEach(() => {
  markNavigation();
});

describe("the spatial focus reveal", () => {
  test("a D-pad move scrolls the row only as far as the 24px margin needs", async () => {
    layOutRow();
    render(<Harness />);
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    expect(track).not.toBeNull();

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    await waitFor(() => expect(document.activeElement).toBe(one));
    expect(track?.scrollLeft, "the first card is already inside the margin").toBe(0);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(
      track?.scrollLeft,
      "the second card's right edge sits exactly on the margin",
    ).toBe(284);

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).toBe(one));
    expect(
      track?.scrollLeft,
      "the first card comes back to x 24, not to the row's start",
    ).toBe(16);
  });

  test("a direct focus's reveal seeds the guard, so the engine does not repeat it", async () => {
    const { measured } = layOutRow();
    render(<Harness direct />);

    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft, "the child's focusAndReveal brings the card in").toBe(284);
    expect(
      measured.row,
      "one reveal pass measured the row; ensureFocus skipped its own pass",
    ).toBe(1);
  });

  test("an ordinary render does not scroll a control someone wheeled away", async () => {
    layOutRow();
    const { rerender } = render(<Harness />);

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    await waitFor(() => expect(document.activeElement).toBe(one));

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft).toBe(284);

    if (track) {
      track.scrollLeft = 0;
    }
    rerender(<Harness />);
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(
      track?.scrollLeft,
      "the guard keeps the scroll where the person left it",
    ).toBe(0);
  });

  test("a card auto-focused on mount is revealed once", async () => {
    const { measured } = layOutRow();
    render(<Harness auto />);

    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft, "the mount focus brings the card in").toBe(284);
    expect(measured.row, "and the engine's ensureFocus pass is the one reveal").toBe(1);
  });

  test("a programmatic focus is revealed by the focusin path", async () => {
    layOutRow();
    render(<Harness />);

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    await waitFor(() => expect(document.activeElement).toBe(one));
    expect(track?.scrollLeft).toBe(0);

    two?.focus();

    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(
      track?.scrollLeft,
      "focus outside focusAndReveal still goes through the guarded listener",
    ).toBe(284);
  });

  test("focus leaving the level forgets the guard, so a return reveals again", async () => {
    layOutRow();
    render(<Harness />);

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    await waitFor(() => expect(document.activeElement).toBe(one));

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft).toBe(284);

    const outside = document.createElement("button");
    document.body.append(outside);
    if (track) {
      track.scrollLeft = 0;
    }

    // A focus outside the level clears the guard. The engine's own re-home is
    // queued, so the return is made in the same pass to stay outside it.
    outside.focus();
    two?.focus();

    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft, "the return reveals the same control again").toBe(284);
  });

  test("the spine's Right returns to the content control focus came from", async () => {
    layOutSpine();
    render(<SpineHarness />);

    const home = document.querySelector<HTMLElement>('[data-testid="rail-home"]');
    const hero = document.querySelector<HTMLElement>('[data-testid="hero"]');
    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    await waitFor(() => expect(document.activeElement).toBe(home));

    // First entry has no history: the rail enters the first content control.
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(hero));

    // Into the row, along it, and back to its first card.
    fireEvent.keyDown(document, { key: "ArrowDown" });
    await waitFor(() => expect(document.activeElement).toBe(one));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(two));
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).toBe(one));

    // Left off the row's edge enters the spine; it remembers the row's card.
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).toBe(home));

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(one));
    expect(document.activeElement, "not the hero a no-history fallback would enter").not.toBe(
      hero,
    );
  });

  test("a control inside a subtree that turned inert is not kept as the level's focus", async () => {
    layOutRow();
    const { rerender } = render(<Harness />);

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    await waitFor(() => expect(document.activeElement).toBe(one));

    // A real browser moves focus off an inert subtree; jsdom leaves the active
    // element where it was. The engine must not accept it as the level's focus.
    rerender(<Harness inertFirst />);
    await waitFor(() => expect(document.activeElement).toBe(two));
  });

  test("a remembered control that turned disabled is not revealed", async () => {
    layOutRow();
    render(<Harness />);

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    await waitFor(() => expect(document.activeElement).toBe(one));

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft).toBe(284);

    // The level still remembers the second card, but it is disabled now and
    // refuses focus. A browser moves focus off it; the engine then re-homes to
    // the remembered control and must not reveal the refused focus.
    two?.setAttribute("disabled", "");
    if (track) {
      track.scrollLeft = 0;
    }
    const outside = document.createElement("button");
    document.body.append(outside);
    outside.focus();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.activeElement, "a disabled control cannot take focus").toBe(outside);
    expect(
      track?.scrollLeft,
      "a refused focus must not reveal the remembered control's stale box",
    ).toBe(0);
  });

  test("pointer modality moves focus without revealing; navigation reveals", async () => {
    layOutRow();
    markPointer();
    render(<Harness />);

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    const track = document.querySelector<HTMLElement>('[data-testid="track"]');
    await waitFor(() => expect(document.activeElement).toBe(one));
    expect(track?.scrollLeft, "the mount focus is not revealed under the pointer").toBe(0);

    two?.focus();
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft, "a pointer focus moves focus and nothing else").toBe(0);

    markNavigation();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await waitFor(() => expect(document.activeElement).toBe(one));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(track?.scrollLeft, "navigation reveals the card on the movement's axis").toBe(
      284,
    );
  });

  test("the cut-off first press focuses without activating; the second activates", async () => {
    layOutRow();
    markPointer();
    const activated = vi.fn();
    const stop = installPointerPress(document.documentElement, {
      focusAndReveal: (control) =>
        focusAndReveal(control, { mode: "nearest", force: true }),
    });

    try {
      render(<Harness onActivate={activated} />);
      const one = document.querySelector<HTMLElement>('[data-testid="one"]');
      const two = document.querySelector<HTMLElement>('[data-testid="two"]');
      const track = document.querySelector<HTMLElement>('[data-testid="track"]');
      await waitFor(() => expect(document.activeElement).toBe(one));

      fireEvent.pointerDown(two as HTMLElement);
      fireEvent.click(two as HTMLElement);

      await waitFor(() => expect(document.activeElement).toBe(two));
      expect(activated, "the cut-off first press is not the one aimed at").not.toHaveBeenCalled();
      expect(track?.scrollLeft, "it focuses and reveals the card minimally").toBe(284);

      fireEvent.pointerDown(two as HTMLElement);
      fireEvent.click(two as HTMLElement);

      expect(activated, "the second press activates the now-focused control").toHaveBeenCalledTimes(1);
    } finally {
      stop();
    }
  });

  test("Escape in pointer modality keeps pointer modality while arrow keys enter navigation", async () => {
    layOutRow();
    markPointer();
    render(<Harness />);

    const one = document.querySelector<HTMLElement>('[data-testid="one"]');
    const two = document.querySelector<HTMLElement>('[data-testid="two"]');
    await waitFor(() => expect(document.activeElement).toBe(one));

    fireEvent.keyDown(document, { key: "Escape" });
    expect(inputModality()).toBe("pointer");

    fireEvent.keyDown(document, { key: "ArrowRight" });
    await waitFor(() => expect(document.activeElement).toBe(two));
    expect(inputModality()).toBe("navigation");
  });
});
