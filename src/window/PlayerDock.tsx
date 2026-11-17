import { useState } from "react";

import { autoplayStrip } from "../core/autoplay";
import { VOLUME_MAX, formatVolume, volumeFraction } from "../core/controls";
import { remainingTime, timelineFraction } from "../core/osd";
import { formatTime, watching } from "../core/playback";
import { usePlaybackView } from "../core/react/usePlaybackView";
import { transportControls } from "../core/transportControls";
import type { PlaybackState, Picture } from "../core/wire";
import { Button } from "../kit/Button";
import { Icon } from "../kit/icons";
import { PendingSpinner } from "../kit/PendingSpinner";
import { useShell } from "./context";
import "./repertory/dock.css";

/**
 * Whether the window draws the docked transport.
 *
 * Something is playing, but the picture is not in this window: mpv has a
 * window of its own, or the Host has no video output at all. There is no
 * rectangle to print an OSD over, so the transport is a band at the foot of
 * the page instead. The rule is the window's, not the Host's: `watching` and
 * `picture` are facts every client reads (#194, ADR-0035 §2).
 */
export function dockedTransport(state: PlaybackState, picture: Picture): boolean {
  return watching(state) && picture !== "in_window";
}

/**
 * The docked transport: the core's playback facts drawn as one band above the
 * foot of the page.
 *
 * Every control is the OSD's and the Remote's: play/pause, a timeline that
 * seeks on release, Stop, volume and mute. The OSD's focus ladder, idle clock,
 * popovers and chapter chrome stay out of it because they are drawn over a
 * picture; the dock instead shares the frame's focus root with the browsing
 * page and the level on top, so the D-pad can reach it without any surface
 * below becoming reachable.
 */
export function PlayerDock() {
  const { session, take } = useShell();
  const view = usePlaybackView(session, true);
  const [scrub, setScrub] = useState<number | null>(null);
  const [volume, setVolume] = useState<number | null>(null);

  if (!view || !dockedTransport(view.state, view.picture)) {
    return null;
  }

  const controls = transportControls(view);
  const playPause = controls.find((control) => control.id === "playPause")!;
  const stop = controls.find((control) => control.id === "stop")!;
  const duration = view.duration;
  const at = scrub ?? view.position ?? 0;
  const hasDuration = duration !== null && Number.isFinite(duration) && duration > 0;
  const seekable = view.transportable && hasDuration;
  const shownLevel = volume ?? view.volume.level;

  const commitSeek = () => {
    if (scrub === null || !seekable || duration === null) {
      return;
    }
    const seconds = Math.min(duration, Math.max(0, scrub));
    setScrub(null);
    void take({ type: "seek", target: { kind: "to", seconds } });
  };

  const commitVolume = () => {
    if (volume === null || !view.controllable) {
      return;
    }
    const level = volume;
    setVolume(null);
    void take({ type: "set_volume", level });
  };

  return (
    <section
      className="shell-player-dock"
      aria-label="Player transport"
      role="region"
      data-testid="player-dock"
      data-state={view.state}
      data-picture={view.picture}
      data-region="player-dock"
      data-kind="row"
      data-label="Player transport"
    >
      <div className="shell-player-dock-meta">
        <p className="shell-player-dock-kicker">
          <span>Now playing</span>
          <span className="shell-player-dock-kicker-rule" aria-hidden="true" />
          <span data-testid="player-dock-episode">
            {autoplayStrip(view.autoplay) ?? view.episodeLabel}
          </span>
        </p>
        <p className="shell-player-dock-title" data-testid="player-dock-title">
          {view.title}
        </p>
        {view.pictureNote ? (
          <p className="shell-player-dock-note" data-testid="player-dock-note" role="status">
            {view.pictureNote}
          </p>
        ) : null}
      </div>

      <div className="shell-player-dock-transport">
        <button
          type="button"
          className="shell-player-dock-control shell-player-dock-play"
          data-focusable
          data-testid="dock-play-pause"
          aria-label={playPause.label}
          aria-busy={playPause.pending || undefined}
          data-pending={playPause.pending ? "true" : undefined}
          disabled={playPause.disabled || playPause.pending}
          onClick={() => void take(playPause.action)}
        >
          {playPause.pending ? (
            <PendingSpinner />
          ) : (
            <Icon name={playPause.icon} strokeWidth={2.2} />
          )}
        </button>

        <div className="shell-player-dock-timeline">
          <span className="shell-player-dock-clock tabular" data-testid="dock-elapsed">
            {formatTime(at)}
          </span>
          <span className="shell-player-dock-track">
            <span className="shell-player-dock-track-rail" aria-hidden="true" />
            {view.buffered ? (
              <span
                className="shell-player-dock-track-buffered"
                aria-hidden="true"
                style={{
                  left: `${view.buffered.left * 100}%`,
                  width: `${view.buffered.width * 100}%`,
                }}
              />
            ) : null}
            <span
              className="shell-player-dock-track-progress"
              aria-hidden="true"
              style={{ width: `${timelineFraction(at, duration) * 100}%` }}
            />
            <span
              className="shell-player-dock-track-playhead"
              aria-hidden="true"
              style={{ left: `${timelineFraction(at, duration) * 100}%` }}
            />
            <input
              type="range"
              className="shell-player-dock-range"
              aria-label="Position"
              data-testid="dock-position"
              min={0}
              max={hasDuration ? duration : 0}
              step={1}
              value={hasDuration ? Math.min(at, duration) : 0}
              aria-valuetext={formatTime(at)}
              disabled={!seekable}
              onChange={(event) => {
                if (seekable) {
                  setScrub(Number(event.target.value));
                }
              }}
              onPointerUp={commitSeek}
              onKeyUp={commitSeek}
              onBlur={commitSeek}
              data-focusable
            />
          </span>
          <span className="shell-player-dock-clock tabular" data-testid="dock-remaining">
            {remainingTime(at, duration)}
          </span>
        </div>
      </div>

      <div className="shell-player-dock-settings">
        {view.autoplay.kind === "countdown" ? (
          <Button
            variant="ghost"
            className="shell-player-dock-autoplay-cancel"
            data-testid="dock-autoplay-cancel"
            onClick={() => void take({ type: "cancel_autoplay" })}
          >
            Cancel
          </Button>
        ) : null}
        {view.autoplay.kind === "still_watching" ? (
          <Button
            variant="ghost"
            className="shell-player-dock-autoplay-cancel"
            data-testid="dock-autoplay-keep-watching"
            onClick={() => void take({ type: "next_episode" })}
          >
            Keep watching
          </Button>
        ) : null}
        <div className="shell-player-dock-volume" role="group" aria-label="Volume">
          <span className="shell-player-dock-volume-level tabular" data-testid="dock-volume-level">
            {formatVolume(shownLevel)}
          </span>
          <span className="shell-player-dock-fader">
            <span className="shell-player-dock-fader-rail" aria-hidden="true" />
            <span
              className="shell-player-dock-fader-fill"
              aria-hidden="true"
              style={{ width: `${volumeFraction(shownLevel) * 100}%` }}
            />
            <span
              className="shell-player-dock-fader-playhead"
              aria-hidden="true"
              style={{ left: `${volumeFraction(shownLevel) * 100}%` }}
            />
            <input
              type="range"
              className="shell-player-dock-range"
              aria-label="Volume"
              data-testid="dock-volume"
              min={0}
              max={VOLUME_MAX}
              step={1}
              value={shownLevel}
              aria-valuetext={formatVolume(shownLevel)}
              disabled={!view.controllable}
              onChange={(event) => {
                if (view.controllable) {
                  setVolume(Number(event.target.value));
                }
              }}
              onPointerUp={commitVolume}
              onKeyUp={commitVolume}
              onBlur={commitVolume}
              data-focusable
            />
          </span>
          <button
            type="button"
            className="shell-player-dock-control"
            data-focusable
            data-testid="dock-mute"
            aria-label={view.volume.muted ? "Unmute" : "Mute"}
            aria-pressed={view.volume.muted}
            disabled={!view.controllable}
            onClick={() => void take({ type: "set_muted", muted: !view.volume.muted })}
          >
            <Icon name={view.volume.muted ? "volume-muted" : "volume"} strokeWidth={2} />
          </button>
        </div>

        <button
          type="button"
          className="shell-player-dock-control shell-player-dock-stop"
          data-focusable
          data-testid="dock-stop"
          aria-label={stop.label}
          aria-busy={stop.pending || undefined}
          data-pending={stop.pending ? "true" : undefined}
          disabled={stop.pending}
          onClick={() => void take(stop.action)}
        >
          {stop.pending ? <PendingSpinner /> : <Icon name={stop.icon} strokeWidth={2.2} />}
        </button>
      </div>
    </section>
  );
}
