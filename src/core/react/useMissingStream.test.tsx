import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { autoplayView, opensPicker, type AutoplayView } from "../autoplay";
import { useMissingStream } from "./useMissingStream";

function missing(id: string, detail = "none"): AutoplayView {
  return autoplayView(
    {
      autoplay: {
        next: {
          title: { type: "series", id: "tt1" },
          video: { type: "series", id },
          episode: { season: 1, episode: 2 },
          name: null,
          still: null,
        },
        phase: "no_stream",
        detail,
      },
    },
    0,
  );
}

const NONE: AutoplayView = { kind: "none" };

describe("opening once per missing-Stream target", () => {
  test("opens when a target appears, and a repeated Snapshot for it opens nothing more", () => {
    const open = vi.fn();
    const { rerender } = renderHook(
      ({ view }) => useMissingStream(view, opensPicker, open),
      { initialProps: { view: NONE as AutoplayView } },
    );
    expect(open).not.toHaveBeenCalled();

    rerender({ view: missing("tt1:1:2") });
    rerender({ view: missing("tt1:1:2", "a later Snapshot, same target") });

    expect(open).toHaveBeenCalledTimes(1);
    expect(open.mock.calls[0]![0].next.video.id).toBe("tt1:1:2");
  });

  test("a different target opens again, and the same one after it was cleared does too", () => {
    const open = vi.fn();
    const { rerender } = renderHook(
      ({ view }) => useMissingStream(view, opensPicker, open),
      { initialProps: { view: missing("tt1:1:2") as AutoplayView } },
    );
    rerender({ view: missing("tt1:1:3") });
    rerender({ view: NONE });
    rerender({ view: missing("tt1:1:3") });

    expect(open).toHaveBeenCalledTimes(3);
  });

  test("the client's rule can refuse, and a refused target is not opened later", () => {
    const open = vi.fn();
    let allowed = false;
    const { rerender } = renderHook(
      ({ view }) => useMissingStream(view, (a, b) => allowed && opensPicker(a, b), open),
      { initialProps: { view: NONE as AutoplayView } },
    );

    rerender({ view: missing("tt1:1:2") });
    allowed = true;
    rerender({ view: missing("tt1:1:2", "same target, once the client may") });

    expect(open).not.toHaveBeenCalled();
  });

  test("the rule and the opening read what the client holds now, not at the render that made the effect", () => {
    const seen: string[] = [];
    const { rerender } = renderHook(
      ({ view, level }) =>
        useMissingStream(
          view,
          () => true,
          () => seen.push(level),
        ),
      { initialProps: { view: NONE as AutoplayView, level: "browse" } },
    );

    rerender({ view: missing("tt1:1:2"), level: "player" });

    expect(seen).toEqual(["player"]);
  });
});
