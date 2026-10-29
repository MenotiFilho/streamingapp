import { describe, expect, test } from "vitest";

import {
  HOST_ERROR_KINDS,
  answeredLibrary,
  answeredPreview,
  asActionError,
  explain,
} from "./host-client";

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
    expect(HOST_ERROR_KINDS).toContain("library");
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

  test("a refused subtitle colour and size say what the Host takes instead", () => {
    const colour = asActionError({
      kind: "invalid_subtitle_color",
      color: "#FFFFF",
    });
    expect(explain(colour)).toBe(
      '"#FFFFF" is not a subtitle colour — a colour is "#RRGGBB", like "#FFFF00".',
    );

    const scale = asActionError({ kind: "invalid_subtitle_scale", scale: "2.5" });
    expect(explain(scale)).toBe(
      '"2.5" is not a subtitle size — a size is between 0.5 and 2.0.',
    );
  });

  test("a refused Library read is read as the account's failure", () => {
    const error = asActionError({
      kind: "library",
      detail: "Stremio refused the request: Session does not exist",
    });

    expect(error.kind).toBe("library");
    expect(explain(error)).toBe(
      "The Host could not read the Stremio Library: Stremio refused the request: Session does not exist.",
    );
  });

  test("a kind that is not one of the Host's stays unreachable", () => {
    expect(asActionError({ kind: "something_new" })).toEqual({
      kind: "unreachable",
      detail: "[object Object]",
    });
  });
});

describe("the Seek preview's answer", () => {
  test("carries the moment asked about and the still, where there is one", () => {
    const answer = answeredPreview({
      snapshots: [],
      answer: { preview: { at: 42.5, image: "data:image/jpeg;base64,AAAA" } },
    });

    expect(answer).toEqual({ at: 42.5, image: "data:image/jpeg;base64,AAAA" });
  });

  test("is null when the Action was something else, and carries no image where the Host had none", () => {
    expect(answeredPreview(null)).toBeNull();
    expect(answeredPreview({ snapshots: [], answer: null })).toBeNull();
    expect(
      answeredPreview({ snapshots: [], answer: { preview: { at: 42, image: null } } }),
      "a still that cannot be produced is an answer with no image, not a failure",
    ).toEqual({ at: 42, image: null });
  });

  test("a refused moment says what it was", () => {
    const error = asActionError({ kind: "invalid_preview_at", seconds: "NaN" });

    expect(error.kind).toBe("invalid_preview_at");
    expect(explain(error)).toBe('"NaN" is not a moment of the Stream to take a still of.');
  });
});

describe("the account Library's answer", () => {
  test("carries the rows and the failure, and is null for another Action", () => {
    const library = answeredLibrary({
      snapshots: [],
      answer: {
        library: {
          entries: [],
          failure: { kind: "library", detail: "Session does not exist" },
        },
      },
    });
    expect(library?.entries).toEqual([]);
    expect(library?.failure?.kind).toBe("library");

    expect(
      answeredLibrary({ snapshots: [], answer: { preview: { at: 1, image: null } } }),
    ).toBeNull();
    expect(answeredLibrary(null)).toBeNull();
  });
});
