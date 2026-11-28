import { describe, expect, test } from "vitest";

import type { AddonManifest, Response } from "../core/wire";
import { NOTHING } from "./fakeSocket.testing";
import {
  ADDONS_EMPTY,
  addRequest,
  addOutcomeAfter,
  moveRequest,
  removeBody,
  removeLevel,
} from "./addonsScreen";

/**
 * The Addons screen's decisions (#209, ADR-0032).
 *
 * The screen is drawn from these: what a submit sends, what a successful add
 * says through the core's `addOutcome`, where a Move press lands, and what a
 * Remove press pushes. Nothing here reads a component.
 */

const CINEMETA: AddonManifest = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [{ type: "movie", id: "top", name: "Top", extra: [] }],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const SUBTITLES: AddonManifest = {
  id: "opensubtitles",
  name: "OpenSubtitles v3",
  version: "1.0.0",
  resources: [{ name: "subtitles", types: ["movie"], idPrefixes: ["tt"] }],
  types: ["movie"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

/** An answer that carries one Snapshot, as a successful Change publishes. */
function answerWith(addons: AddonManifest[]): Response {
  return { snapshots: [{ ...NOTHING, revision: 2, addons }], answer: null };
}

describe("the Addons form's submit", () => {
  test("a pasted manifest is sent trimmed, and a blank field is not a question", () => {
    expect(addRequest("  https://example.com/manifest.json  ")).toEqual({
      type: "add_addon",
      url: "https://example.com/manifest.json",
    });
    expect(addRequest("")).toBeNull();
    expect(addRequest("   \n\t ")).toBeNull();
  });
});

describe("what a successful add says", () => {
  test("a new Addon is read from the answer's last Snapshot", () => {
    expect(addOutcomeAfter([], answerWith([CINEMETA]))).toEqual({
      kind: "added",
      name: "Cinemeta",
    });
  });

  test("an Addon the Host already knew is a refresh, not a failed add", () => {
    expect(addOutcomeAfter([CINEMETA], answerWith([CINEMETA]))).toEqual({
      kind: "refreshed",
      name: null,
    });
    expect(
      addOutcomeAfter([CINEMETA], answerWith([{ ...CINEMETA, version: "3.0.15" }])),
    ).toEqual({ kind: "refreshed", name: "Cinemeta" });
  });

  test("an answer that carries no Snapshot has nothing to say", () => {
    expect(addOutcomeAfter([CINEMETA], null)).toBeNull();
    expect(addOutcomeAfter([CINEMETA], { snapshots: [], answer: null })).toBeNull();
  });
});

describe("a Move press", () => {
  test("asks for the position moveTarget names", () => {
    expect(moveRequest("cinemeta", 1, -1, 3)).toEqual({
      type: "reorder_addon",
      id: "cinemeta",
      position: 0,
    });
    expect(moveRequest("cinemeta", 1, 1, 3)).toEqual({
      type: "reorder_addon",
      id: "cinemeta",
      position: 2,
    });
  });

  test("asks nothing at either end of the register", () => {
    expect(moveRequest("cinemeta", 0, -1, 3)).toBeNull();
    expect(moveRequest("cinemeta", 2, 1, 3)).toBeNull();
  });
});

describe("a Remove press", () => {
  test("pushes a confirm level carrying the question and the Action as data", () => {
    expect(removeLevel(CINEMETA)).toEqual({
      id: "confirm-remove-cinemeta",
      name: "Remove Cinemeta?",
      kind: "overlay",
      payload: {
        kind: "confirm",
        confirm: {
          id: "confirm-remove-cinemeta",
          title: "Remove Cinemeta?",
          body: removeBody(CINEMETA),
          confirmLabel: "Remove",
          action: { type: "remove_addon", id: "cinemeta" },
        },
      },
    });
  });

  test("names the rows an Addon's Catalogs feed, and only where it has some", () => {
    expect(removeBody(CINEMETA)).toContain("Its rows leave Home.");
    expect(removeBody(SUBTITLES)).not.toContain("Its rows leave Home.");
    expect(removeBody(SUBTITLES)).toContain("Watch progress already recorded stays");
  });
});

describe("an empty register", () => {
  test("names the way on — the form — rather than an empty list", () => {
    expect(ADDONS_EMPTY.body).toContain("form");
  });
});
