import { describe, expect, test } from "vitest";

import { formatRate, torrentLine } from "./torrentStatus";

describe("the torrent line", () => {
  test("a torrent still being found says how many peers it has", () => {
    expect(torrentLine({ phase: "finding", peers: 5, rate: 0 })).toBe(
      "Finding the torrent · 5 peers",
    );
  });

  test("a torrent being fetched says its peers and how fast bytes arrive", () => {
    expect(torrentLine({ phase: "fetching", peers: 12, rate: 4_200_000 })).toBe(
      "Fetching · 12 peers · 4.2 MB/s",
    );
  });

  test("one peer is singular, in either phase", () => {
    expect(torrentLine({ phase: "finding", peers: 1, rate: 0 })).toBe(
      "Finding the torrent · 1 peer",
    );
    expect(torrentLine({ phase: "fetching", peers: 1, rate: 800 })).toBe(
      "Fetching · 1 peer · 800 B/s",
    );
  });

  test("no peers is plural", () => {
    expect(torrentLine({ phase: "finding", peers: 0, rate: 0 })).toBe(
      "Finding the torrent · 0 peers",
    );
  });
});

describe("the download rate", () => {
  test("is in decimal units, as the Stream buffer's megabytes are", () => {
    expect(formatRate(0)).toBe("0 B/s");
    expect(formatRate(999)).toBe("999 B/s");
    expect(formatRate(1_000)).toBe("1 kB/s");
    expect(formatRate(512_400)).toBe("512 kB/s");
    expect(formatRate(999_400)).toBe("999 kB/s");
  });

  test("takes one decimal place from one megabyte a second", () => {
    expect(formatRate(999_999), "a rate that rounds up to a megabyte is one").toBe("1.0 MB/s");
    expect(formatRate(1_000_000)).toBe("1.0 MB/s");
    expect(formatRate(4_200_000)).toBe("4.2 MB/s");
    expect(formatRate(12_340_000)).toBe("12.3 MB/s");
  });
});
