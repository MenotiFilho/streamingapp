import { describe, expect, test } from "vitest";

import { PREVIEW_STILLS_KEPT, rememberStill } from "./usePreview";

/**
 * The client's share of the Seek preview (#140, ADR-0028): the buckets a drag
 * has crossed, bounded the way the Host bounds its own two hundred, so a long
 * drag cannot keep a film's worth of stills in the window.
 */
describe("the stills a client keeps", () => {
  test("a bucket answered again replaces its answer and stays recent", () => {
    const cache = new Map<number, string | null>();

    rememberStill(cache, 1, "first");
    rememberStill(cache, 2, "second");
    rememberStill(cache, 1, "first again");

    expect(cache.get(1)).toBe("first again");
    expect([...cache.keys()]).toEqual([2, 1]);
  });

  test("an answer of no still is kept, so the Host is not asked twice", () => {
    const cache = new Map<number, string | null>();

    rememberStill(cache, 7, null);

    expect(cache.has(7)).toBe(true);
    expect(cache.get(7)).toBeNull();
  });

  test("two hundred buckets are the most a client holds, the oldest leaving first", () => {
    const cache = new Map<number, string | null>();
    for (let bucket = 0; bucket < PREVIEW_STILLS_KEPT + 10; bucket += 1) {
      rememberStill(cache, bucket, `still ${bucket}`);
    }

    expect(cache.size).toBe(PREVIEW_STILLS_KEPT);
    expect(cache.has(0)).toBe(false);
    expect(cache.has(PREVIEW_STILLS_KEPT + 9)).toBe(true);
  });
});
