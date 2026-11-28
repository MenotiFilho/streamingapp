import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { ActionError } from "../errors";
import { NOTHING } from "../../remote/fakeSocket.testing";
import type { Snapshot } from "../wire";
import { useLanguageList, type Ask } from "./useLanguageList";

function snapshotWith(subtitleLanguages: string[]): Snapshot {
  return {
    ...NOTHING,
    preferences: {
      ...NOTHING.preferences,
      subtitleLanguages,
    },
  };
}

describe("useLanguageList", () => {
  test("updates optimistically while pending, then rolls back to the Snapshot's languages and surfaces error on refusal", async () => {
    const refusal: ActionError = { kind: "store", detail: "the store is read-only" };
    let resolveAsk!: (outcome: { error?: ActionError | null }) => void;
    const ask = vi.fn<Ask>(
      () =>
        new Promise((resolve) => {
          resolveAsk = resolve;
        }),
    );

    const { result } = renderHook(() =>
      useLanguageList("subtitle", snapshotWith(["pt-BR", "en"]), ask),
    );

    expect(result.current.list).toEqual(["pt-BR", "en"]);
    expect(result.current.current()).toEqual(["pt-BR", "en"]);
    expect(result.current.error).toBeNull();

    let pendingChange!: Promise<void>;
    act(() => {
      pendingChange = result.current.change(["pt-BR"]);
    });

    expect(ask).toHaveBeenCalledWith({
      type: "set_subtitle_languages",
      languages: ["pt-BR"],
    });
    expect(result.current.list).toEqual(["pt-BR"]);
    expect(result.current.current()).toEqual(["pt-BR"]);

    await act(async () => {
      resolveAsk({ error: refusal });
      await pendingChange;
    });

    expect(result.current.error).toEqual(refusal);
    expect(result.current.list).toEqual(["pt-BR", "en"]);
    expect(result.current.current()).toEqual(["pt-BR", "en"]);
  });

  test("ignores a null decision without asking", async () => {
    const ask = vi.fn<Ask>(async () => ({ error: null }));
    const { result } = renderHook(() =>
      useLanguageList("audio", snapshotWith([]), ask),
    );

    await act(async () => {
      await result.current.change(null);
    });

    expect(ask).not.toHaveBeenCalled();
    expect(result.current.error).toBeNull();
  });
});
