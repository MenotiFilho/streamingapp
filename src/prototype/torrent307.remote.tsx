/* PROTOTYPE (#307, throwaway — never merged): Remote client player hooks for variants A, B, and C. */
import { remainingTime } from "../core/osd";
import { formatTime, playingName } from "../core/playback";
import type { PlaybackView } from "../core/playbackView";
import { PendingSpinner } from "../kit/PendingSpinner";
import { ENDED_NOTE, openingNote } from "../remote/playerScreen";
import {
  PROTO,
  formatCornerChip,
  formatPeers,
  formatTorrentLine,
  formatTorrentRate,
  useTorrentProto,
} from "./torrent307";

/** Docked strip status note (right below Title / episode when watching on a browse screen). */
export function remoteStripStatusNote(
  view: PlaybackView,
  variant: "A" | "B" | "C",
  graceElapsed: boolean,
): string | null {
  if (!PROTO) {
    return view.pictureNote;
  }

  let protoNote: string | null = null;
  if (variant === "A") {
    if (view.stalled && graceElapsed) {
      protoNote = "Waiting…";
    } else if (view.state === "opening" && view.torrent) {
      protoNote = formatTorrentLine(view.torrent);
    }
  } else if (variant === "B") {
    if (view.stalled) {
      protoNote = view.torrent
        ? `Stalled · ${formatPeers(view.torrent.peers)} · ${formatTorrentRate(view.torrent.rate)}`
        : "Stalled";
    } else if (view.state === "opening" && view.torrent) {
      protoNote =
        view.torrent.phase === "finding"
          ? `(1) Finding · ${formatPeers(view.torrent.peers)}`
          : `(2) Fetching · ${formatPeers(view.torrent.peers)} · ${formatTorrentRate(view.torrent.rate)}`;
    }
  } else if (variant === "C") {
    if (view.stalled) {
      protoNote = view.torrent
        ? `Waiting · P2P · ${formatPeers(view.torrent.peers)} · ${formatTorrentRate(view.torrent.rate)}`
        : "Waiting for the Stream";
    } else if (view.torrent) {
      protoNote = formatCornerChip(view.torrent, false);
    }
  }

  if (protoNote && view.pictureNote) {
    return `${protoNote} · ${view.pictureNote}`;
  }
  return protoNote ?? view.pictureNote;
}

/** Variant B: two-step ladder drawn inside the Remote card's PlayerPlate while opening. */
export function RemotePlateLadder({ view }: { view: PlaybackView }) {
  const { variant } = useTorrentProto();

  if (!PROTO || variant !== "B" || view.state !== "opening" || !view.torrent) {
    return null;
  }

  const finding = view.torrent.phase === "finding";

  return (
    <div className="proto-remote-ladder" data-testid="proto-remote-ladder">
      <div className="proto-remote-ladder-step" data-state={finding ? "active" : "done"}>
        <span>(1) Finding the torrent</span>
        {finding ? (
          <span className="proto-remote-ladder-chips">
            <span className="proto-remote-chip" data-tone="accent">
              {formatPeers(view.torrent.peers)}
            </span>
          </span>
        ) : null}
      </div>
      <div className="proto-remote-ladder-step" data-state={finding ? "pending" : "active"}>
        <span>(2) Fetching</span>
        {!finding ? (
          <span className="proto-remote-ladder-chips">
            <span className="proto-remote-chip" data-tone="accent">
              {formatPeers(view.torrent.peers)}
            </span>
            <span className="proto-remote-chip">{formatTorrentRate(view.torrent.rate)}</span>
          </span>
        ) : null}
      </div>
    </div>
  );
}

/** Remote expanded card state & chip rows for variants A, B, and C. */
export function RemoteCardStatus({ view }: { view: PlaybackView }) {
  const { variant, graceElapsed } = useTorrentProto();
  const baseNote =
    view.state === "opening"
      ? openingNote(playingName(view.nowPlaying))
      : view.state === "ended"
        ? ENDED_NOTE
        : null;

  if (!PROTO) {
    return baseNote ? (
      <p className="remote-player-state" role="status">
        {baseNote}
      </p>
    ) : null;
  }

  if (variant === "A") {
    if (view.stalled && graceElapsed) {
      return (
        <p
          className="proto-remote-state-line"
          data-stalled="true"
          role="status"
          data-testid="remote-proto-state"
        >
          <PendingSpinner />
          <span>
            {view.torrent
              ? `Waiting for the Stream…\n${formatTorrentLine(view.torrent)}`
              : "Waiting for the Stream…"}
          </span>
        </p>
      );
    }
    if (view.state === "opening" && view.torrent) {
      return (
        <p className="proto-remote-state-line" role="status" data-testid="remote-proto-state">
          <span>{`${baseNote}\n${formatTorrentLine(view.torrent)}`}</span>
        </p>
      );
    }
  }

  if (variant === "C") {
    const showChips = view.stalled || view.torrent !== null;
    return (
      <>
        {showChips ? (
          <div
            className="proto-remote-chips"
            data-stalled={view.stalled ? "true" : "false"}
            data-testid="remote-proto-chips"
            role="status"
          >
            {view.stalled ? (
              <span className="proto-remote-chip" data-tone="accent">
                <span className="proto-remote-chip-dot" aria-hidden="true" />
                {view.torrent ? "Stalled" : "Waiting for the Stream"}
              </span>
            ) : null}
            {view.torrent ? (
              <>
                <span className="proto-remote-chip" data-tone={view.stalled ? undefined : "accent"}>
                  P2P
                </span>
                {view.torrent.phase === "finding" ? (
                  <span className="proto-remote-chip" data-tone="ok">
                    Finding
                  </span>
                ) : null}
                <span className="proto-remote-chip">{formatPeers(view.torrent.peers)}</span>
                {view.torrent.phase === "fetching" ? (
                  <span className="proto-remote-chip">
                    {formatTorrentRate(view.torrent.rate)}
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {baseNote ? (
          <p className="remote-player-state" role="status">
            {baseNote}
          </p>
        ) : null}
      </>
    );
  }

  return baseNote ? (
    <p className="remote-player-state" role="status">
      {baseNote}
    </p>
  ) : null;
}

/** Remote timeline clocks row (Variant B draws Stalled + torrent chips beside elapsed time). */
export function RemoteTimelineClocks({
  view,
  shown,
}: {
  view: PlaybackView;
  shown: number;
}) {
  const { variant } = useTorrentProto();

  if (!PROTO || variant !== "B" || !view.stalled) {
    return (
      <div className="remote-player-clocks" aria-hidden="true">
        <span className="tabular">{formatTime(shown)}</span>
        <span className="tabular">{remainingTime(shown, view.duration)}</span>
      </div>
    );
  }

  return (
    <div className="remote-player-clocks" aria-hidden="true">
      <span className="proto-remote-clock-stalled" data-testid="remote-stalled-clock">
        <span className="tabular">{formatTime(shown)}</span>
        <span className="proto-remote-stalled-tag">Stalled</span>
        {view.torrent ? (
          <>
            <span className="proto-remote-chip" data-tone="accent">
              {formatPeers(view.torrent.peers)}
            </span>
            <span className="proto-remote-chip">
              {formatTorrentRate(view.torrent.rate)}
            </span>
          </>
        ) : null}
      </span>
      <span className="tabular">{remainingTime(shown, view.duration)}</span>
    </div>
  );
}
