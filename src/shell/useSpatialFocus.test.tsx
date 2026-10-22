import { fireEvent, render, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useSpatialFocus } from "./useSpatialFocus";

/**
 * jsdom has no layout. The track is 600px wide and the second card starts at
 * x 700, so a Right press has to move the row 284px (700 + 160 - (600 - 24)).
 * The cards' client rects follow the track's scrollLeft, as a real browser's
 * would, so a Left press afterwards has to bring the first card back.
 */
function layOutRow() {
  return vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement): DOMRect {
      const key = this.dataset.testid ?? this.dataset.region;
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
}

function Harness() {
  const root = useRef<HTMLDivElement | null>(null);
  useSpatialFocus({
    root: () => root.current,
    levelKey: "reveal-test",
    onBack: () => {},
  });

  return (
    <div ref={root} data-region="screen" data-kind="branch" data-label="the screen">
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
        <button data-focusable data-testid="two">
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
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 600 });
    Object.defineProperty(track, "clientHeight", { configurable: true, value: 300 });

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
});
