import { VOLUME_MAX } from "../../../core/controls";
import { controlState, PhoneIconButton } from "./controls";
import { clampRatio, levelAt, volumeKeyTarget } from "./seekMath";
import { useDragSlider } from "./useDragSlider";

export type VolumeBoxProps = {
  /** The Host's own level. */
  level: number;
  /** The top of the Host's scale. */
  max?: number;
  muted: boolean;
  /** The finger lifted, or a key was released: one change. */
  onCommit: (level: number) => void;
  onMute: (muted: boolean) => void;
  disabled?: boolean;
  /** The mute asked for is still in flight. */
  mutePending?: boolean;
};

/** The Host's own volume and mute, always on the remote (sheet `C8`). */
export function VolumeBox({
  level,
  max = VOLUME_MAX,
  muted,
  onCommit,
  onMute,
  disabled = false,
  mutePending = false,
}: VolumeBoxProps) {
  const slider = useDragSlider({
    value: level,
    enabled: !disabled,
    valueAt: (ratio) => levelAt(ratio, max),
    keyTarget: (key, from) => volumeKeyTarget(key, from, max),
    onCommit,
  });
  const shown = Math.round(slider.shown);
  const filled = max > 0 ? clampRatio(shown / max) * 100 : 0;

  return (
    <div className="mq-ph-volume">
      <PhoneIconButton
        label={muted ? "Unmute" : "Mute"}
        icon={muted ? "mute" : "volume-2"}
        aria-pressed={muted}
        {...controlState({ pending: mutePending }, disabled)}
        onClick={() => onMute(!muted)}
      />
      <div
        {...slider.handlers}
        className="mq-ph mq-ph-slider mq-ph-volume-hit"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        data-focusable
        aria-label="Volume"
        aria-disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={shown}
      >
        <span className="mq-ph-volume-track" aria-hidden="true">
          <span className="mq-ph-volume-level" style={{ width: `${filled}%` }} />
          <span className="mq-ph-volume-knob" style={{ left: `${filled}%` }} />
        </span>
      </div>
      <span className="mq-ph-volume-value" aria-hidden="true">
        {shown}
      </span>
    </div>
  );
}
