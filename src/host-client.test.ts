import { describe, expect, test } from "vitest";

import { HOST_ERROR_KINDS, asActionError, explain } from "./host-client";

/**
 * The window's reading of a refusal, tested where it is decided: a `kind` the
 * Host sends and this client does not know becomes `unreachable`, which says the
 * Host was never reached rather than that it refused (#74).
 */
describe("the refusals the Host can send", () => {
  test("the kinds a refusal can travel as are the ones the window reads", () => {
    // `ActionError::Subtitles` and `ActionError::InvalidPosition` were the two
    // the window could not name: both fell through every check into
    // `unreachable`, and a person read "the window could not reach the Host".
    expect(HOST_ERROR_KINDS).toContain("subtitles");
    expect(HOST_ERROR_KINDS).toContain("invalid_position");
  });

  test("a subtitles failure is read as an Addon failure", () => {
    const error = asActionError({
      kind: "subtitles",
      detail: "the Addon answered a web page",
    });

    expect(error.kind).toBe("subtitles");
    expect(explain(error)).toBe(
      "The Host could not read that Addon's subtitles response: the Addon answered a web page.",
    );
  });

  test("a refused reorder says what the Host had instead", () => {
    const error = asActionError({
      kind: "invalid_position",
      id: "community.stremboxd",
      position: 3,
      count: 3,
    });

    expect(error.kind).toBe("invalid_position");
    expect(explain(error)).toBe("The Host has no Addon position 3 — it is configured with 3.");
  });

  test("a kind that is not one of the Host's stays unreachable", () => {
    expect(asActionError({ kind: "something_new" })).toEqual({
      kind: "unreachable",
      detail: "[object Object]",
    });
  });
});
