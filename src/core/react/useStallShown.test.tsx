import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useStallShown } from "./useStallShown";

let now = 0;

beforeEach(() => {
  now = 0;
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockImplementation(() => now);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function advance(ms: number) {
  act(() => {
    now += ms;
    vi.advanceTimersByTime(ms);
  });
}

describe("useStallShown", () => {
  test("is up only after one continuous second of Stalled", () => {
    const { result } = renderHook(({ stalled }) => useStallShown(stalled), {
      initialProps: { stalled: true },
    });
    expect(result.current).toBe(false);

    advance(999);
    expect(result.current).toBe(false);

    advance(1);
    expect(result.current).toBe(true);
  });

  test("draws nothing for a stall that ends inside the second, and starts the next one over", () => {
    const { result, rerender } = renderHook(({ stalled }) => useStallShown(stalled), {
      initialProps: { stalled: true },
    });

    advance(600);
    rerender({ stalled: false });
    advance(600);
    expect(result.current).toBe(false);

    rerender({ stalled: true });
    advance(600);
    expect(result.current).toBe(false);
    advance(400);
    expect(result.current).toBe(true);
  });

  test("goes the moment Stalled ends", () => {
    const { result, rerender } = renderHook(({ stalled }) => useStallShown(stalled), {
      initialProps: { stalled: true },
    });
    advance(1500);
    expect(result.current).toBe(true);

    rerender({ stalled: false });
    expect(result.current).toBe(false);
  });

  test("is never up for a Stream that is not Stalled", () => {
    const { result } = renderHook(() => useStallShown(false));
    advance(10_000);
    expect(result.current).toBe(false);
  });

  test("still shows when the one-second timer fires a fraction of a millisecond early", () => {
    const { result } = renderHook(({ stalled }) => useStallShown(stalled), {
      initialProps: { stalled: true },
    });
    expect(result.current).toBe(false);

    // Simulate setTimeout(..., 1000) firing while performance.now() reads 999.7 ms.
    act(() => {
      now = 999.7;
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(true);
  });
});
