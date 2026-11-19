/**
 * How a client says the **Torrent status** the Host publishes (#341, ADR-0042 §5).
 *
 * The Host publishes the reading — finding or fetching, peers, bytes a second —
 * and never which torrent. What it is called is the client's own decision, here,
 * and the same for the window and the Remote: one line, the same words.
 */

import type { TorrentStatus } from "./wire";

/** "1 peer", "12 peers". */
function peersOf(peers: number): string {
  return `${peers} ${peers === 1 ? "peer" : "peers"}`;
}

/**
 * A download rate in decimal units — `B/s`, `kB/s`, `MB/s` — the way the Stream
 * buffer's megabytes are decimal. Whole numbers below a megabyte a second, one
 * decimal place from there up.
 */
export function formatRate(bytesPerSecond: number): string {
  if (bytesPerSecond < 1_000) {
    return `${Math.round(bytesPerSecond)} B/s`;
  }
  const kilobytes = Math.round(bytesPerSecond / 1_000);
  if (kilobytes < 1_000) {
    return `${kilobytes} kB/s`;
  }
  return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;
}

/**
 * The one line the opening block and the Stalled card carry for a torrent:
 * `Finding the torrent · 5 peers`, or `Fetching · 12 peers · 4.2 MB/s`.
 */
export function torrentLine(status: TorrentStatus): string {
  if (status.phase === "finding") {
    return `Finding the torrent · ${peersOf(status.peers)}`;
  }
  return `Fetching · ${peersOf(status.peers)} · ${formatRate(status.rate)}`;
}
