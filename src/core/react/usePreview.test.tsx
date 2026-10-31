import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { ActionOutcome } from "../answers";
import type { Action } from "../wire";
import { usePreview } from "./usePreview";

type Held = {
  action: Action;
  answer: (image: string | null) => void;
};

function answering() {
  const asks: Held[] = [];
  const ask = (action: Action): Promise<ActionOutcome> =>
    new Promise((resolve) => {
      asks.push({
        action,
        answer: (image) =>
          resolve({
            response: {
              snapshots: [],
              answer: { preview: { at: (action as { at: number }).at, image } },
            },
            error: null,
          }),
      });
    });
  return { ask, asks };
}

describe("the seek preview hook", () => {
  test("keeps one ask in flight, then asks the newest bucket the pointer reached", async () => {
    const { ask, asks } = answering();
    const { result } = renderHook(() => usePreview("stream", ask));

    act(() => result.current.point(10));
    expect(asks).toHaveLength(1);
    expect(asks[0]!.action).toEqual({ type: "preview", at: 10 });
    expect(result.current.waiting).toBe(true);

    act(() => result.current.point(20));
    expect(asks, "the second bucket waits for the first answer").toHaveLength(1);

    await act(async () => {
      asks[0]!.answer("first");
      await Promise.resolve();
    });
    expect(asks, "the newest bucket wins once the Host is free").toHaveLength(2);
    expect(asks[1]!.action).toEqual({ type: "preview", at: 20 });
    expect(result.current.still, "the first still is not the bucket hovered").toBeNull();

    await act(async () => {
      asks[1]!.answer("second");
      await Promise.resolve();
    });
    expect(result.current.still).toEqual({ bucket: 4, image: "second" });
    expect(result.current.waiting).toBe(false);
  });

  test("an answer for the Stream before it is dropped when another Stream starts", async () => {
    const { ask, asks } = answering();
    const { result, rerender } = renderHook(
      ({ stream }) => usePreview(stream, ask),
      { initialProps: { stream: "one" } },
    );

    act(() => result.current.point(10));
    expect(asks).toHaveLength(1);

    rerender({ stream: "two" });
    await act(async () => {
      asks[0]!.answer("late");
      await Promise.resolve();
    });

    expect(result.current.still).toBeNull();
    expect(result.current.waiting).toBe(false);
  });

  test("a bucket already answered is read from the cache and asks nothing", async () => {
    const { ask, asks } = answering();
    const { result } = renderHook(() => usePreview("stream", ask));

    act(() => result.current.point(10));
    await act(async () => {
      asks[0]!.answer("first");
      await Promise.resolve();
    });
    expect(result.current.still).toEqual({ bucket: 2, image: "first" });

    act(() => result.current.point(null));
    act(() => result.current.point(10));

    expect(asks).toHaveLength(1);
    expect(result.current.still).toEqual({ bucket: 2, image: "first" });
  });
});
