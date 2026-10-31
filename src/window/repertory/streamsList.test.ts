import { describe, expect, test } from "vitest";

import { badgeRole, candidateCount, candidateCountLabel, groupAnswerNote, NO_CANDIDATES } from "./streamsList";

describe("the Streams list's bookkeeping", () => {
  test("the count says candidates, singular where there is one", () => {
    expect(candidateCount(12)).toBe("12 candidates");
    expect(candidateCount(1)).toBe("1 candidate");
    expect(candidateCount(0)).toBe("0 candidates");
  });

  test("the kicker says candidates and Addons, singular where there is one", () => {
    expect(candidateCountLabel(12, 3)).toBe("12 candidates / 3 Addons");
    expect(candidateCountLabel(1, 1)).toBe("1 candidate / 1 Addon");
    expect(candidateCountLabel(0, 2)).toBe("0 candidates / 2 Addons");
  });

  test("the Addon's first badge line is the source, every line after it a mark", () => {
    expect(badgeRole(0)).toBe("source");
    expect(badgeRole(1)).toBe("quality");
    expect(badgeRole(4)).toBe("quality");
  });
});

describe("a group's answer", () => {
  test("an Addon that answered nothing says so; one with candidates says nothing", () => {
    expect(groupAnswerNote({ streams: [], failure: null })).toBe(NO_CANDIDATES);
    expect(
      groupAnswerNote({
        streams: [
          {
            name: "AIOStreams\n1080p",
            description: null,
            playback: { kind: "direct", url: "https://stream.example.org/a.mkv" },
            warnings: [],
            filename: null,
            bingeGroup: null,
          },
        ],
        failure: null,
      }),
    ).toBeNull();
  });

  test("a failed Addon is the Host's refusal, not the empty-answer line", () => {
    expect(
      groupAnswerNote({
        streams: [],
        failure: { kind: "fetch", detail: "the Addon answered with status 503" },
      }),
    ).toBeNull();
  });
});
