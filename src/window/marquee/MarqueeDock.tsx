import { useState } from "react";

import { VOLUME_MAX, formatVolume, volumeFraction } from "../../core/controls";
import { remainingTime, timelineFraction } from "../../core/osd";
import { formatTime, watching } from "../../core/playback";
import { episodeLine } from "../../core/playbackView";
import { usePlaybackView } from "../../core/react/usePlaybackView";
import { transportControls } from "../../core/transportControls";
import type { PlaybackState, Picture } from "../../core/wire";
import { Button } from "../../kit/Button";
import { IconButton } from "../../kit/IconButton";
import { useShell } from "../context";
import "./dock.css";

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
 * The docked transport: the core's playback facts drawn as one glass band at
 * the foot of the page.
 *
 * Every control is the OSD's and the Remote's: play/pause, a timeline that
 * seeks on release, Stop, volume and mute. The OSD's focus ladder, idle clock,
 * panels and chapter chrome stay out of it because they are drawn over a
 * picture; the dock instead shares the frame's focus root with the browsing
 * page and the Level on top, so the D-pad can reach it without any surface
 * below becoming reachable.
 */
export function MarqueeDock() {
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
      className="mq-dock"
      aria-label="Player transport"
      role="region"
      data-testid="player-dock"
      data-state={view.state}
      data-picture={view.picture}
      data-region="player-dock"
      data-kind="row"
      data-label="Player transport"
    >
      <div className="mq-dock-meta">
        <p className="mq-dock-kicker">
          <span className="mq-dock-now">Now playing</span>
          <span className="mq-dock-episode" data-testid="player-dock-episode">
            {episodeLine(view)}
          </span>
        </p>
        <p className="mq-dock-title" data-testid="player-dock-title">
          {view.title}
        </p>
        {view.pictureNote ? (
          <p className="mq-dock-note" data-testid="player-dock-note" role="status">
            {view.pictureNote}
          </p>
        ) : null}
      </div>

      <div className="mq-dock-transport">
        <IconButton
          icon={playPause.pending ? "notch" : playPause.icon === "play" ? "play" : "pause"}
          label={playPause.label}
          size="md"
          data-testid="dock-play-pause"
          aria-busy={playPause.pending || undefined}
          disabled={playPause.disabled || playPause.pending}
          onClick={() => void take(playPause.action)}
        />

        <div className="mq-dock-timeline">
          <span className="mq-dock-clock" data-testid="dock-elapsed">
            {formatTime(at)}
          </span>
          <span className="mq-dock-track">
            <span className="mq-dock-rail" aria-hidden="true">
              {view.buffered ? (
                <span
                  className="mq-dock-buffered"
                  style={{
                    left: `${view.buffered.left * 100}%`,
                    width: `${view.buffered.width * 100}%`,
                  }}
                />
              ) : null}
              <span
                className="mq-dock-played"
                style={{ width: `${timelineFraction(at, duration) * 100}%` }}
              />
            </span>
            <span
              className="mq-dock-playhead"
              aria-hidden="true"
              style={{ left: `${timelineFraction(at, duration) * 100}%` }}
            />
            <input
              type="range"
              className="mq-dock-range"
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
          <span className="mq-dock-clock" data-testid="dock-remaining">
            {remainingTime(at, duration)}
          </span>
        </div>
      </div>

      <div className="mq-dock-settings">
        {view.autoplay.kind === "countdown" ? (
          <Button
            size="md"
            data-testid="dock-autoplay-cancel"
            onClick={() => void take({ type: "cancel_autoplay" })}
          >
            Cancel
          </Button>
        ) : null}
        {view.autoplay.kind === "still_watching" ? (
          <Button
            size="md"
            data-testid="dock-autoplay-keep-watching"
            onClick={() => void take({ type: "next_episode" })}
          >
            Keep watching
          </Button>
        ) : null}
        <div className="mq-dock-volume" role="group" aria-label="Volume">
          <span className="mq-dock-clock mq-dock-level" data-testid="dock-volume-level">
            {formatVolume(shownLevel)}
          </span>
          <span className="mq-dock-track mq-dock-fader">
            <span className="mq-dock-rail" aria-hidden="true">
              <span
                className="mq-dock-fill"
                style={{ width: `${volumeFraction(shownLevel) * 100}%` }}
              />
            </span>
            <span
              className="mq-dock-playhead"
              aria-hidden="true"
              style={{ left: `${volumeFraction(shownLevel) * 100}%` }}
            />
            <input
              type="range"
              className="mq-dock-range"
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
          <IconButton
            icon={view.volume.muted ? "mute" : "volume-2"}
            label={view.volume.muted ? "Unmute" : "Mute"}
            kind="ghost"
            size="sm"
            data-testid="dock-mute"
            aria-pressed={view.volume.muted}
            disabled={!view.controllable}
            onClick={() => void take({ type: "set_muted", muted: !view.volume.muted })}
          />
        </div>

        <IconButton
          icon={stop.pending ? "notch" : "stop"}
          label={stop.label}
          size="sm"
          data-testid="dock-stop"
          aria-busy={stop.pending || undefined}
          disabled={stop.pending}
          onClick={() => void take(stop.action)}
        />
      </div>
    </section>
  );
}
