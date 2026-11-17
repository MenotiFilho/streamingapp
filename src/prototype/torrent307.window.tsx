/* PROTOTYPE (#307, throwaway — never merged): Window player UI hooks for variants A, B, and C. */
import { formatTime, playingName } from "../core/playback";
import type { PlaybackView } from "../core/playbackView";
import { Chip } from "../kit/Chip";
import { PendingSpinner } from "../kit/PendingSpinner";
import {
  PROTO,
  formatCornerChip,
  formatPeers,
  formatTorrentLine,
  formatTorrentRate,
  useTorrentProto,
} from "./torrent307";

/** Opening preview copy inside `.shell-player-preview-copy`. */
export function WindowOpeningStatus({ view }: { view: PlaybackView }) {
  const { variant } = useTorrentProto();
  const baseLine = `Opening ${playingName(view.nowPlaying)}…`;

  if (!PROTO || view.state !== "opening") {
    return (
      <p className="shell-player-preview-note" data-testid="opening-stream">
        {baseLine}
      </p>
    );
  }

  if (variant === "A") {
    return (
      <>
        <p className="shell-player-preview-note" data-testid="opening-stream">
          {baseLine}
        </p>
        {view.torrent ? (
          <p className="proto-note-line" data-testid="proto-torrent-note">
            {formatTorrentLine(view.torrent)}
          </p>
        ) : null}
      </>
    );
  }

  if (variant === "B" && view.torrent) {
    const finding = view.torrent.phase === "finding";
    return (
      <>
        <p className="shell-player-preview-note" data-testid="opening-stream">
          {baseLine}
        </p>
        <div className="proto-ladder" data-testid="proto-step-ladder">
          <div className="proto-ladder-step" data-state={finding ? "active" : "done"}>
            <span className="proto-ladder-num">(1)</span>
            <span>Finding the torrent</span>
            {finding ? (
              <span className="proto-ladder-chips">
                <Chip tone="accent">{formatPeers(view.torrent.peers)}</Chip>
              </span>
            ) : null}
          </div>
          <div className="proto-ladder-step" data-state={finding ? "pending" : "active"}>
            <span className="proto-ladder-num">(2)</span>
            <span>Fetching</span>
            {!finding ? (
              <span className="proto-ladder-chips">
                <Chip tone="accent">{formatPeers(view.torrent.peers)}</Chip>
                <Chip>{formatTorrentRate(view.torrent.rate)}</Chip>
              </span>
            ) : null}
          </div>
        </div>
      </>
    );
  }

  return (
    <p className="shell-player-preview-note" data-testid="opening-stream">
      {baseLine}
    </p>
  );
}

/** Variant A: centered spinner ring + wait line over the picture after a 1s stalled grace. */
export function WindowStallRing({ view }: { view: PlaybackView }) {
  const { variant, graceElapsed } = useTorrentProto();

  if (!PROTO || variant !== "A" || !view.stalled || !graceElapsed) {
    return null;
  }

  return (
    <div className="proto-stall-center" role="status" data-testid="proto-stall-ring">
      <span className="proto-stall-center-ring" aria-hidden="true">
        <PendingSpinner />
      </span>
      <p className="proto-stall-center-title">Waiting for the Stream…</p>
      {view.torrent ? (
        <p className="proto-stall-center-sub">{formatTorrentLine(view.torrent)}</p>
      ) : null}
    </div>
  );
}

/** Variant C: persistent top-right corner chip while opening, stalled, or OSD up during torrent play. */
export function WindowCornerChip({
  view,
  osdVisible,
}: {
  view: PlaybackView;
  osdVisible: boolean;
}) {
  const { variant } = useTorrentProto();

  if (!PROTO || variant !== "C") {
    return null;
  }

  const show =
    (view.state === "opening" && view.torrent !== null) ||
    view.stalled ||
    (osdVisible && view.torrent !== null && view.state !== "idle" && view.state !== "ended");

  if (!show) {
    return null;
  }

  const label = formatCornerChip(view.torrent, view.stalled);
  if (!label) {
    return null;
  }

  return (
    <div
      className="proto-corner-chip"
      data-osd={osdVisible ? "true" : "false"}
      data-stalled={view.stalled ? "true" : "false"}
      data-testid="proto-corner-chip"
      role="status"
    >
      {view.stalled ? <span className="proto-corner-dot" aria-hidden="true" /> : null}
      <span>{label}</span>
    </div>
  );
}

/** Variant B: Stalled label + torrent chips beside the timeline's elapsed clock. */
export function WindowTimelineElapsed({
  view,
  at,
}: {
  view: PlaybackView;
  at: number;
}) {
  const { variant } = useTorrentProto();
  const formatted = formatTime(at);

  if (!PROTO || variant !== "B" || !view.stalled) {
    return (
      <span className="shell-osd-elapsed tabular" data-testid="elapsed">
        {formatted}
      </span>
    );
  }

  return (
    <div className="proto-elapsed-cluster" data-testid="proto-stalled-timeline">
      <span className="shell-osd-elapsed tabular" data-testid="elapsed">
        {formatted}
      </span>
      <span className="proto-stalled-label" data-testid="proto-stalled-label">
        Stalled
      </span>
      {view.torrent ? (
        <>
          <Chip tone="accent">{formatPeers(view.torrent.peers)}</Chip>
          <Chip>{formatTorrentRate(view.torrent.rate)}</Chip>
        </>
      ) : null}
    </div>
  );
}
