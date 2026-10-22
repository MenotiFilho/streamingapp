import { fireEvent, render, waitFor } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

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

function Harness({ direct = false, auto = false }: { direct?: boolean; auto?: boolean }) {
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
        <button data-focusable data-testid="one">
          One
        </button>
        <button data-focusable data-testid="two" autoFocus={auto}>
          Two
        </button>
      </div>
    </div>
  );
}

afterEach(() => {
  vi.restoreAllMocks();
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
});
