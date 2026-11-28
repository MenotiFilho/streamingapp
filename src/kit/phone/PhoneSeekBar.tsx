import { timelineFraction, remainingTime } from "../../core/osd";
import { formatTime } from "../../core/playback";
import { clampRatio, seekKeyTarget } from "./seekMath";
import { useDragSlider } from "./useDragSlider";

export type PhoneSeekBarProps = {
  /** Where the Host is, in seconds; null while it has no number. */
  position: number | null;
  /** The Stream's length in seconds; null while unknown, which holds the bar. */
  duration: number | null;
  /** What the Player has read ahead, as fractions of the track (`bufferedSpan`). */
  buffered?: { left: number; width: number } | null;
  /** The finger lifted: seek there. */
  onSeek: (seconds: number) => void;
  disabled?: boolean;
};

/**
 * The phone's seek bar (sheet `C8`): drag the playhead, and the Host seeks when
 * the finger lifts.
 */
export function PhoneSeekBar({
  position,
  duration,
  buffered,
  onSeek,
  disabled = false,
}: PhoneSeekBarProps) {
  const length = duration !== null && Number.isFinite(duration) && duration > 0 ? duration : null;
  const enabled = !disabled && length !== null;
  const slider = useDragSlider({
    value: position ?? 0,
    enabled,
    valueAt: (ratio) => ratio * (length ?? 0),
    keyTarget: (key, from) => seekKeyTarget(key, from, length ?? 0),
    onCommit: onSeek,
  });
  const shown = length === null ? position : slider.dragging ? slider.shown : position;
  const played = timelineFraction(shown, length);
  const elapsed = formatTime(shown);

  return (
    <div className="mq-ph-seek">
      <div
        {...slider.handlers}
        className="mq-ph mq-ph-slider mq-ph-seek-hit"
        role="slider"
        tabIndex={enabled ? 0 : -1}
        data-focusable
        aria-label="Seek"
        aria-disabled={!enabled}
        aria-valuemin={0}
        aria-valuemax={Math.round(length ?? 0)}
        aria-valuenow={Math.round(shown ?? 0)}
        aria-valuetext={`${elapsed} of ${formatTime(length)}`}
      >
        <span className="mq-ph-seek-track" aria-hidden="true">
          {buffered ? (
            <span
              className="mq-ph-seek-buffered"
              style={{
                left: `${clampRatio(buffered.left) * 100}%`,
                width: `${clampRatio(buffered.width) * 100}%`,
              }}
            />
          ) : null}
          <span className="mq-ph-seek-played" style={{ width: `${played * 100}%` }} />
          <span className="mq-ph-seek-playhead" style={{ left: `${played * 100}%` }} />
        </span>
      </div>
      <span className="mq-ph-seek-elapsed" aria-hidden="true">
        {elapsed}
      </span>
      <span className="mq-ph-seek-remaining" aria-hidden="true">
        {remainingTime(shown, length)}
      </span>
    </div>
  );
}
