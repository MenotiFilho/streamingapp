import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { useGridEnd } from "./useGridEnd";

function Grid({
  count,
  ahead,
  onReach,
}: {
  count: number;
  ahead?: number | (() => number);
  onReach: () => void;
}) {
  const ref = useGridEnd({
    count,
    page: { done: false, failure: null },
    reading: false,
    onReach,
    ahead,
  });

  return (
    <div ref={(node) => { ref.current = node; }}>
      {Array.from({ length: count }, (_, index) => (
        <button key={index} type="button" data-grid-card>
          Card {index}
        </button>
      ))}
    </div>
  );
}

describe("useGridEnd", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("re-evaluates function-form ahead after a window resize", () => {
    // Keep the last card far below the fold so only focus-ahead paging can fire.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      bottom: 100_000,
    } as DOMRect);

    let columnsAhead = 4;
    const ahead = vi.fn(() => columnsAhead);
    const onReach = vi.fn();

    render(<Grid count={12} ahead={ahead} onReach={onReach} />);

    // Card at index 4 has 8 cards after it; with ahead=4 it is not near the end.
    act(() => {
      screen.getByRole("button", { name: "Card 4" }).focus();
    });
    expect(onReach).not.toHaveBeenCalled();

    const callsBeforeResize = ahead.mock.calls.length;
    columnsAhead = 10;

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });

    expect(ahead.mock.calls.length).toBeGreaterThan(callsBeforeResize);
    expect(onReach).toHaveBeenCalledTimes(1);
  });
});
