/**
 * The player's control row (sheet `C6`, 1792×80): volume at the left, the
 * transport in the middle, and **Next episode** with the menu triggers at the
 * right. The open menu's button stays white.
 *
 * There is deliberately no Previous episode and no Stop here: Stop is the top
 * bar's close and the client's Back.
 *
 * The volume level takes a pointer drag, Page Up, Page Down, Home and End; the
 * arrows stay the focus engine's, and the pad's volume faces step it (#57).
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import { formatVolume, VOLUME_MAX } from "../../core/controls";
import { playerMenus, type PlayerMenuId } from "./playerMenus";
import { PpButton, PpIconButton } from "./ppParts";
import { levelAt, levelKeyTarget } from "./seekMath";

export type PlayerControlId =
  | "mute"
  | "volume"
  | "rewind"
  | "playPause"
  | "forward"
  | "nextEpisode"
  | PlayerMenuId;

/** The transport's step either way. */
const SKIP_SECONDS = 10;

export type PlayerControlsProps = {
  /** Whether the Stream is playing: the middle button then offers Pause. */
  playing: boolean;
  volume: number;
  volumeMax?: number;
  /** One Page Up or Page Down press on the level. */
  volumeStep?: number;
  muted?: boolean;
  onPlayPause: () => void;
  /** `-10` or `10`. */
  onSeekBy: (seconds: number) => void;
  onToggleMute: () => void;
  /** The level chosen, once per drag or key press, when it is let go. */
  onVolume: (level: number) => void;
  /** Draws the **Next episode** pill where there is an episode to step to. */
  onNextEpisode?: () => void;
  nextEpisodeDisabled?: boolean;
  /** The menus this Stream has; all eight when omitted. */
  menus?: ReadonlyArray<PlayerMenuId>;
  /** The menu that is up. */
  openMenu?: PlayerMenuId | null;
  fullscreen?: boolean;
  onMenu: (menu: PlayerMenuId) => void;
  /** The Stream takes no transport right now, as while it opens. */
  disabled?: boolean;
  /** The controls whose own Action is still in flight. */
  pending?: ReadonlyArray<PlayerControlId>;
  /** Draw this control focused, whatever the input modality. */
  focused?: PlayerControlId;
};

export function PlayerControls({
  playing,
  volume,
  volumeMax = VOLUME_MAX,
  volumeStep = 5,
  muted = false,
  onPlayPause,
  onSeekBy,
  onToggleMute,
  onVolume,
  onNextEpisode,
  nextEpisodeDisabled = false,
  menus,
  openMenu = null,
  fullscreen = false,
  onMenu,
  disabled = false,
  pending = [],
  focused,
}: PlayerControlsProps) {
  const waits = (control: PlayerControlId) => pending.includes(control);

  return (
    <div className="mq-pp mq-pp-controls" role="group" aria-label="Player controls">
      <div className="mq-pp-controls-volume">
        <PpIconButton
          kind="ghost"
          icon={muted ? "mute" : "volume-2"}
          label={muted ? "Unmute" : "Mute"}
          aria-pressed={muted}
          focused={focused === "mute"}
          pending={waits("mute")}
          onClick={onToggleMute}
        />
        <VolumeLevel
          volume={volume}
          max={volumeMax}
          step={volumeStep}
          muted={muted}
          focused={focused === "volume"}
          onVolume={onVolume}
        />
      </div>

      <div className="mq-pp-controls-transport">
        <PpIconButton
          kind="ghost"
          icon="rotate-ccw"
          label="Back ten seconds"
          focused={focused === "rewind"}
          disabled={disabled}
          pending={waits("rewind")}
          onClick={() => onSeekBy(-SKIP_SECONDS)}
        />
        <PpIconButton
          size="XL"
          icon={playing ? "pause" : "play"}
          iconWeight="fill"
          label={playing ? "Pause" : "Play"}
          focused={focused === "playPause"}
          disabled={disabled}
          pending={waits("playPause")}
          onClick={onPlayPause}
        />
        <PpIconButton
          kind="ghost"
          icon="rotate-cw"
          label="Forward ten seconds"
          focused={focused === "forward"}
          disabled={disabled}
          pending={waits("forward")}
          onClick={() => onSeekBy(SKIP_SECONDS)}
        />
      </div>

      <div className="mq-pp-controls-end">
        {onNextEpisode ? (
          <PpButton
            icon="skip-forward"
            iconWeight="fill"
            focused={focused === "nextEpisode"}
            disabled={nextEpisodeDisabled}
            pending={waits("nextEpisode")}
            onClick={onNextEpisode}
          >
            Next episode
          </PpButton>
        ) : null}
        <div className="mq-pp-controls-menus">
          {playerMenus(menus).map((menu) => {
            const toggle = menu.id === "fullscreen";
            const label = toggle && fullscreen ? "Exit full screen" : menu.label;
            return (
              <PpIconButton
                key={menu.id}
                kind="ghost"
                icon={menu.icon}
                label={label}
                title={label}
                open={!toggle && openMenu === menu.id}
                aria-haspopup={toggle ? undefined : "dialog"}
                aria-expanded={toggle ? undefined : openMenu === menu.id}
                aria-pressed={toggle ? fullscreen : undefined}
                focused={focused === menu.id}
                pending={waits(menu.id)}
                onClick={() => onMenu(menu.id)}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

/** The 160-wide level beside the speaker. */
function VolumeLevel({
  volume,
  max,
  step,
  muted,
  focused,
  onVolume,
}: {
  volume: number;
  max: number;
  step: number;
  muted: boolean;
  focused: boolean;
  onVolume: (level: number) => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  /** The pending level, readable by the event that follows before a render. */
  const pending = useRef<number | null>(null);
  const dragging = useRef(false);

  const shown = draft ?? volume;
  // A muted Player is silent whatever level it holds; a drag shows its own.
  const drawn = muted && draft === null ? 0 : shown;
  const share = max > 0 ? Math.min(1, Math.max(0, drawn / max)) : 0;

  const move = (level: number) => {
    pending.current = level;
    setDraft(level);
  };

  const drop = () => {
    pending.current = null;
    dragging.current = false;
    setDraft(null);
  };

  const commit = () => {
    const level = pending.current;
    drop();
    if (level !== null) {
      onVolume(level);
    }
  };

  const pointed = (event: PointerEvent<HTMLDivElement>) =>
    levelAt(event.clientX, event.currentTarget.getBoundingClientRect(), max);

  const onKeyDown = (event: KeyboardEvent) => {
    const target = levelKeyTarget(event.key, pending.current ?? volume, max, step);
    if (target !== null) {
      event.preventDefault();
      move(target);
    }
  };

  return (
    <div
      className="mq-pp-volume"
      role="slider"
      tabIndex={0}
      data-focusable
      data-focused={focused ? "true" : undefined}
      aria-label="Volume"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={Math.round(shown)}
      aria-valuetext={muted ? `Muted, ${formatVolume(shown)}` : formatVolume(shown)}
      onKeyDown={onKeyDown}
      onKeyUp={() => !dragging.current && commit()}
      onBlur={commit}
      onPointerDown={(event) => {
        const level = pointed(event);
        if (event.button !== 0 || level === null) {
          return;
        }
        dragging.current = true;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        move(level);
      }}
      onPointerMove={(event) => {
        const level = pointed(event);
        if (dragging.current && level !== null) {
          move(level);
        }
      }}
      onPointerUp={(event) => {
        if (dragging.current) {
          pending.current = pointed(event) ?? pending.current;
          commit();
        }
      }}
      onPointerCancel={drop}
    >
      <span className="mq-pp-volume-track" aria-hidden="true">
        <span className="mq-pp-volume-fill" style={{ width: `${share * 100}%` }} />
      </span>
      <span
        className="mq-pp-volume-knob"
        aria-hidden="true"
        style={{ left: `${share * 100}%` }}
      />
    </div>
  );
}
