import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import type { Session } from "../session";
import type { Title } from "../wire";
import { useRevisedTitle } from "./useRevisedTitle";

function title(overrides: Partial<Title> = {}): Title {
  return {
    addon: "cinemeta",
    id: "tt1",
    key: { kind: "addon", addon: "cinemeta", id: "tt1" },
    type: "series",
    name: "One",
    poster: null,
    background: null,
    logo: null,
    description: null,
    releaseInfo: null,
    runtime: null,
    imdbRating: null,
    genres: [],
    videos: [],
    ...overrides,
  };
}

/** The one Session method the hook uses: the revision subscription. */
function revisions() {
  const handlers = new Set<(revision: Title) => void>();
  return {
    session: {
      onRevision: (handler: (revision: Title) => void) => {
        handlers.add(handler);
        return () => {
          handlers.delete(handler);
        };
      },
    } as Pick<Session, "onRevision">,
    revise: (revision: Title) => {
      for (const handler of handlers) {
        handler(revision);
      }
    },
  };
}

describe("the Title a screen draws", () => {
  test("a revision for that Title replaces it", () => {
    const { session, revise } = revisions();
    const answered = title();
    const { result } = renderHook(() => useRevisedTitle(answered, session));

    act(() => revise(title({ name: "One, made new" })));

    expect(result.current.name).toBe("One, made new");
  });

  test("a revision for another Title is ignored", () => {
    const { session, revise } = revisions();
    const answered = title();
    const { result } = renderHook(() => useRevisedTitle(answered, session));

    act(() => revise(title({ id: "tt2", name: "Something else" })));

    expect(result.current.name).toBe("One");
  });

  test("an answer the level re-pushed is the Title drawn", () => {
    const { session } = revisions();
    const { result, rerender } = renderHook(
      ({ answered }: { answered: Title }) => useRevisedTitle(answered, session),
      { initialProps: { answered: title() } },
    );

    rerender({ answered: title({ name: "One, reopened" }) });

    expect(result.current.name).toBe("One, reopened");
  });
});
