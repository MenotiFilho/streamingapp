/**
 * The player's timeline (sheet `C6`, 1792 wide): the elapsed time, a track with
 * buffered and played fills and ink chapter ticks, a white playhead, and the
 * time remaining. Focused, the bar thickens and the frame under the playhead
 * shows above it; a pointer over the bar shows the frame under the pointer.
 *
 * A pointer drag or a held key moves the playhead at once (`onScrub`) and asks
 * for one seek when it is let go (`onCommit`). `onPoint` names the moment whose
 * Seek preview should be drawn, and the client answers with `still`; where there
 * is none the time and the Chapter stand alone (ADR-0028).
 *
 * The bar keeps no target after a commit: it draws `position` again, and the
 * next press steps from it. Two quick taps made before `position` has taken in
 * the first seek can therefore ask for about one step, not two. A client that
 * wants them to add up passes the target it sent as `position` until a newer
 * Snapshot arrives. Only the client can tell that one has: a projected clock
 * moves `position` without any answer from the Host (ADR-0033).
 *
 * Left, Right, Page Up, Page Down, Home and End are the bar's while it has
 * focus; Up and Down are left to the focus engine. A pad has no key event, so a
 * client routes its Left and Right here with `seekKeyTarget`.
 */

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from "react";

import { REPEAT_AFTER_MS, REPEAT_EVERY_MS } from "../../core/input";
import { inputModality } from "../../core/inputModality";
import { bufferedSpan, chapterMarks, remainingTime, timelineFraction } from "../../core/osd";
import { formatTime } from "../../core/playback";
import type { Buffered, Chapter } from "../../core/wire";
import { forcedFocus } from "./ppParts";
import { clampSeconds, secondsAt, seekable, seekKeyTarget, SEEK_STEP_SECONDS } from "./seekMath";

export type SeekBarProps = {
  /** Where playback is, in seconds; `null` while the Host has no number. */
  position: number | null;
  duration: number | null;
  /** The span the Player has read ahead. */
  buffered?: Buffered | null;
  chapters?: ReadonlyArray<Chapter>;
  /** The still of the moment last named through `onPoint`, where there is one. */
  still?: string | null;
  /** That moment's Chapter, named beside the time while there is no still. */
  chapterName?: string | null;
  /** Seek there. Called once per drag or key press, when it is let go. */
  onCommit: (seconds: number) => void;
  /** The playhead moved under a drag or a held key; nothing is asked yet. */
  onScrub?: (seconds: number) => void;
  /** The moment whose preview is drawn, or `null` when none is. */
  onPoint?: (seconds: number | null) => void;
  /** Seconds one Left or Right press moves. */
  step?: number;
  focused?: boolean;
  disabled?: boolean;
  label?: string;
};

export function SeekBar({
  position,
  duration,
  buffered = null,
  chapters = [],
  still = null,
  chapterName = null,
  onCommit,
  onScrub,
  onPoint,
  step = SEEK_STEP_SECONDS,
  focused,
  disabled = false,
  label = "Position",
}: SeekBarProps) {
  const [scrub, setScrub] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [navigated, setNavigated] = useState(false);
  /** The pending seek, readable by the event that follows before a render. */
  const pending = useRef<number | null>(null);
  const dragging = useRef(false);
  const held = useRef({ first: 0, last: 0 });
  const track = useRef<HTMLSpanElement | null>(null);

  const live = !disabled && seekable(duration);
  const shown = scrub ?? position;
  const at = live ? clampSeconds(shown ?? 0, duration) : (shown ?? 0);
  const point = live ? (scrub ?? hover ?? (focused || navigated ? at : null)) : null;
  const fraction = timelineFraction(shown, duration);
  const span = bufferedSpan(buffered, duration);
  const ticks = chapterMarks([...chapters], duration).filter(
    // A tick on either end would only notch the bar.
    (mark) => mark.fraction > 0 && mark.fraction < 1,
  );

  const told = useRef<number | null>(null);
  useEffect(() => {
    if (told.current !== point) {
      told.current = point;
      onPoint?.(point);
    }
  }, [point, onPoint]);

  const move = (seconds: number) => {
    pending.current = seconds;
    setScrub(seconds);
    onScrub?.(seconds);
  };

  const drop = () => {
    pending.current = null;
    dragging.current = false;
    setScrub(null);
  };

  const commit = () => {
    const seconds = pending.current;
    drop();
    if (seconds !== null && live) {
      onCommit(seconds);
    }
  };

  const pointed = (event: PointerEvent): number | null => {
    const rect = track.current?.getBoundingClientRect();
    return rect ? secondsAt(event.clientX, rect, duration) : null;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (!live) {
      return;
    }
    const target = seekKeyTarget(event.key, pending.current ?? position ?? 0, duration, step);
    if (target === null) {
      return;
    }
    // The bar's own key: the focus engine leaves a handled press alone.
    event.preventDefault();
    setNavigated(true);
    const now = performance.now();
    if (event.repeat) {
      // A held key repeats at the room's one cadence, not the system's.
      if (
        now - held.current.first < REPEAT_AFTER_MS ||
        now - held.current.last < REPEAT_EVERY_MS
      ) {
        return;
      }
      held.current.last = now;
    } else {
      held.current = { first: now, last: now };
    }
    move(target);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    if (!dragging.current && seekKeyTarget(event.key, 0, duration) !== null) {
      commit();
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    const seconds = pointed(event);
    if (!live || event.button !== 0 || seconds === null) {
      return;
    }
    dragging.current = true;
    setNavigated(false);
    event.currentTarget.setPointerCapture?.(event.pointerId);
    move(seconds);
  };

  const onPointerMove = (event: PointerEvent) => {
    const seconds = pointed(event);
    if (!live || seconds === null) {
      return;
    }
    if (dragging.current) {
      move(seconds);
    } else {
      setHover(seconds);
    }
  };

  const onPointerUp = (event: PointerEvent) => {
    if (!dragging.current) {
      return;
    }
    pending.current = pointed(event) ?? pending.current;
    commit();
  };

  return (
    <div
      className="mq-pp mq-pp-seek"
      role="slider"
      tabIndex={live ? 0 : -1}
      data-focusable={live ? true : undefined}
      data-focused={forcedFocus({ focused, disabled: !live })}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={live ? Math.floor(duration) : 0}
      aria-valuenow={live ? Math.floor(at) : 0}
      aria-valuetext={formatTime(shown)}
      aria-disabled={live ? undefined : true}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onFocus={() => setNavigated(inputModality() === "navigation")}
      onBlur={() => {
        setNavigated(false);
        commit();
      }}
    >
      <span className="mq-pp-seek-elapsed">{formatTime(shown)}</span>
      <span
        ref={track}
        className="mq-pp-seek-hit"
        data-testid="mq-seek-track"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={drop}
        onPointerLeave={() => setHover(null)}
      >
        <span className="mq-pp-seek-track" aria-hidden="true">
          {span ? (
            <span
              className="mq-pp-seek-buffered"
              style={{ left: `${span.left * 100}%`, width: `${span.width * 100}%` }}
            />
          ) : null}
          <span className="mq-pp-seek-played" style={{ width: `${fraction * 100}%` }} />
          {ticks.map((mark) => (
            <span
              key={mark.chapter.index}
              className="mq-pp-seek-chapter"
              style={{ left: `${mark.fraction * 100}%` }}
            />
          ))}
        </span>
        <span
          className="mq-pp-seek-playhead"
          aria-hidden="true"
          style={{ left: `${fraction * 100}%` }}
        />
        {point !== null ? (
          <span
            className="mq-pp-seek-preview"
            data-testid="mq-seek-preview"
            data-still={still ? "true" : undefined}
            style={{ "--mq-pp-seek-at": timelineFraction(point, duration) } as CSSProperties}
          >
            {still ? <img src={still} alt="" /> : null}
            <span className="mq-pp-seek-chip">
              {still || !chapterName
                ? formatTime(point)
                : `${formatTime(point)} · ${chapterName}`}
            </span>
          </span>
        ) : null}
      </span>
      <span className="mq-pp-seek-remaining">{remainingTime(shown, duration)}</span>
    </div>
  );
}
