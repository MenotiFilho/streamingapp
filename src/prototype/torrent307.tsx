/* PROTOTYPE (#307, throwaway — never merged): shared pretend state, formatting,
 * 1s stalled grace timer, and floating switcher bar for both clients. */
import { useEffect, useSyncExternalStore } from "react";

import type { PanelGroup } from "../core/playerPanels";
import type { PlaybackSnapshot, TorrentStatus } from "../core/wire";
import {
  PROTO_TORRENT,
  TORRENT_STATE_SPECS,
  protoSetTorrentState,
  readInitialTorrentState,
  torrentSpecOf,
  type TorrentStateId,
  type TorrentStateSpec,
} from "../window/repertory/previewHost";
import "./torrent307.css";

export const PROTO = PROTO_TORRENT;

export type Variant = "A" | "B" | "C";
const VARIANTS: Variant[] = ["A", "B", "C"];
export const VARIANT_NAMES: Record<Variant, string> = {
  A: "Note line",
  B: "Step ladder",
  C: "Corner chip",
};

const STALL_GRACE_MS = 1_000;

function readVariant(): Variant {
  if (typeof window === "undefined") {
    return "A";
  }
  const held = new URLSearchParams(window.location.search).get("variant");
  return VARIANTS.includes(held as Variant) ? (held as Variant) : "A";
}

type ProtoStoreState = {
  variant: Variant;
  stateId: TorrentStateId;
  graceElapsed: boolean;
};

let store: ProtoStoreState = {
  variant: readVariant(),
  stateId: readInitialTorrentState(),
  graceElapsed: false,
};

const listeners = new Set<() => void>();
let graceTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

function setStore(patch: Partial<ProtoStoreState>) {
  store = { ...store, ...patch };
  notify();
}

function armGrace(stalled: boolean) {
  if (graceTimer !== null) {
    clearTimeout(graceTimer);
    graceTimer = null;
  }
  if (!stalled) {
    if (store.graceElapsed) {
      setStore({ graceElapsed: false });
    }
    return;
  }
  setStore({ graceElapsed: false });
  graceTimer = setTimeout(() => {
    graceTimer = null;
    setStore({ graceElapsed: true });
  }, STALL_GRACE_MS);
}

if (PROTO) {
  const initial = torrentSpecOf(store.stateId);
  if (initial.stalled) {
    armGrace(true);
  }
}

export const proto = {
  setVariant(variant: Variant) {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", variant);
    window.history.replaceState(null, "", url);
    setStore({ variant });
  },
  cycleVariant(step: number) {
    const at = VARIANTS.indexOf(store.variant);
    proto.setVariant(VARIANTS[(at + step + VARIANTS.length) % VARIANTS.length]!);
  },
  setState(stateId: TorrentStateId) {
    const url = new URL(window.location.href);
    url.searchParams.set("state", stateId);
    window.history.replaceState(null, "", url);
    const spec = torrentSpecOf(stateId);
    setStore({ stateId, graceElapsed: false });
    protoSetTorrentState(stateId);
    armGrace(spec.stalled);
  },
  cycleState(step: number) {
    const at = TORRENT_STATE_SPECS.findIndex((spec) => spec.id === store.stateId);
    const next =
      TORRENT_STATE_SPECS[
        (at + step + TORRENT_STATE_SPECS.length) % TORRENT_STATE_SPECS.length
      ]!;
    proto.setState(next.id);
  },
};

export type TorrentProtoView = ProtoStoreState & {
  spec: TorrentStateSpec;
};

export function useTorrentProto(): TorrentProtoView {
  const held = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => store,
  );
  return {
    ...held,
    spec: torrentSpecOf(held.stateId),
  };
}

/** Format bytes/sec using decimal SI units (`0 B/s`, `180 kB/s`, `4.2 MB/s`). */
export function formatTorrentRate(bytesPerSecond: number): string {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) {
    return "0 B/s";
  }
  if (bytesPerSecond < 1_000) {
    return `${Math.round(bytesPerSecond)} B/s`;
  }
  if (bytesPerSecond < 1_000_000) {
    return `${Math.round(bytesPerSecond / 1_000)} kB/s`;
  }
  if (bytesPerSecond < 1_000_000_000) {
    return `${(bytesPerSecond / 1_000_000).toFixed(1)} MB/s`;
  }
  return `${(bytesPerSecond / 1_000_000_000).toFixed(1)} GB/s`;
}

export function formatPeers(peers: number): string {
  return `${peers} ${peers === 1 ? "peer" : "peers"}`;
}

export function formatTorrentLine(torrent: TorrentStatus): string {
  if (torrent.phase === "finding") {
    return `Finding the torrent · ${formatPeers(torrent.peers)}`;
  }
  return `Fetching · ${formatPeers(torrent.peers)} · ${formatTorrentRate(torrent.rate)}`;
}

export function formatCornerChip(
  torrent: TorrentStatus | null,
  stalled: boolean,
): string | null {
  if (!torrent) {
    return stalled ? "Waiting for the Stream" : null;
  }
  if (torrent.phase === "finding") {
    return `P2P · Finding · ${formatPeers(torrent.peers)}`;
  }
  return `P2P · ${formatPeers(torrent.peers)} · ${formatTorrentRate(torrent.rate)}`;
}

/** Variant A adds Peers and Download rows to the Statistics panel for a torrent. */
export function withTorrentStatistics(
  groups: PanelGroup[],
  playback: PlaybackSnapshot,
  variant: Variant,
): PanelGroup[] {
  if (!PROTO || variant !== "A" || !playback.torrent) {
    return groups;
  }
  const torrent = playback.torrent;
  return groups.map((group) => ({
    ...group,
    rows: group.rows.map((row) => {
      if (row.kind !== "readout" || row.key !== "statistics" || !row.lines) {
        return row;
      }
      return {
        ...row,
        lines: [
          ...row.lines,
          { label: "Peers", value: String(torrent.peers) },
          { label: "Download", value: formatTorrentRate(torrent.rate) },
        ],
      };
    }),
  }));
}

function debugLine(spec: TorrentStateSpec, graceElapsed: boolean): string {
  const torrentText = spec.torrent
    ? `{phase:"${spec.torrent.phase}", peers:${spec.torrent.peers}, rate:${formatTorrentRate(spec.torrent.rate)}}`
    : "null";
  const failureText = spec.failure ? `"${spec.failure}"` : "null";
  const graceText = spec.stalled ? ` grace=${graceElapsed ? "shown" : "1s-wait"}` : "";
  return `state=${spec.id} · playback=${spec.playbackState} · torrent=${torrentText} · stalled=${String(spec.stalled)}${graceText} · failure=${failureText}`;
}

/**
 * Floating prototype bar: bottom-centre on Window (← → cycle variants),
 * top-docked on Remote, with a second control to cycle `state` and a full
 * debug readout of the current pretend state.
 */
export function PrototypeBar({ surface }: { surface: "window" | "remote" }) {
  const view = useTorrentProto();

  useEffect(() => {
    if (!PROTO) {
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        proto.cycleVariant(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        proto.cycleVariant(1);
      } else if (event.key === "[") {
        proto.cycleState(-1);
      } else if (event.key === "]") {
        proto.cycleState(1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!PROTO || import.meta.env.PROD) {
    return null;
  }

  return (
    <div className="proto-bar" data-surface={surface} data-testid="proto-bar">
      <div className="proto-bar-row">
        <div className="proto-bar-group">
          <button
            type="button"
            data-testid="proto-variant-prev"
            aria-label="Previous variant"
            onClick={() => proto.cycleVariant(-1)}
          >
            ◀
          </button>
          <strong data-testid="proto-variant">
            {view.variant} · {VARIANT_NAMES[view.variant]}
          </strong>
          <button
            type="button"
            data-testid="proto-variant-next"
            aria-label="Next variant"
            onClick={() => proto.cycleVariant(1)}
          >
            ▶
          </button>
        </div>

        <span className="proto-bar-rule" aria-hidden="true" />

        <div className="proto-bar-group">
          <button
            type="button"
            data-testid="proto-state-prev"
            aria-label="Previous state"
            onClick={() => proto.cycleState(-1)}
          >
            ◀
          </button>
          <select
            className="proto-bar-select"
            data-testid="proto-state-select"
            aria-label="Pretend state"
            value={view.stateId}
            onChange={(event) => proto.setState(event.target.value as TorrentStateId)}
          >
            {TORRENT_STATE_SPECS.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {spec.id} — {spec.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="proto-state-next"
            aria-label="Next state"
            onClick={() => proto.cycleState(1)}
          >
            ▶
          </button>
        </div>

        {surface === "window" ? <small>← → variants · [ ] states</small> : null}
      </div>

      <code className="proto-bar-debug" data-testid="proto-debug">
        {debugLine(view.spec, view.graceElapsed)}
      </code>
    </div>
  );
}
