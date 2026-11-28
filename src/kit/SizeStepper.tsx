/**
 * The Subtitle size stepper (sheet `C6`, 352×48): minus, a track slider with a
 * lavender level and a knob, plus, and the value. 25% to 300% in 5% steps
 * (ADR-0044 §5), on the core's ladder; a button at its bound is disabled.
 *
 * Dragging the track previews locally and commits once on release; clicking on
 * the track commits once; Left/Right while the slider holds focus step 5%
 * immediately, as the buttons do.
 */

import { useRef, useState, type KeyboardEvent, type PointerEvent } from "react";

import {
  SUBTITLE_SCALE_MAX,
  SUBTITLE_SCALE_MIN,
  formatScale,
  scaleAtBound,
  scaleFromRatio,
  stepScale,
} from "../core/controls";
import { forcedFocus, PpIconButton } from "./ppParts";
import { pointerFraction } from "./seekMath";
import { sizeFraction } from "./sizeScale";

export type SizeStepperControl = "smaller" | "slider" | "larger";

export type SizeStepperProps = {
  /** The multiplier the Host holds: `1` is 100%. */
  scale: number;
  onChange: (scale: number) => void;
  label?: string;
  disabled?: boolean;
  /** The last size asked for is still in flight. */
  pending?: boolean;
  focused?: SizeStepperControl;
};

const MIN_PCT = Math.round(SUBTITLE_SCALE_MIN * 100);
const MAX_PCT = Math.round(SUBTITLE_SCALE_MAX * 100);

export function SizeStepper({
  scale,
  onChange,
  label = "Subtitle size",
  disabled = false,
  pending = false,
  focused,
}: SizeStepperProps) {
  const [draft, setDraft] = useState<number | null>(null);
  const draftRef = useRef<number | null>(null);
  const dragging = useRef(false);

  const interactive = !disabled && !pending;
  const shown = draft ?? scale;
  const share = sizeFraction(shown);

  const scaleAt = (event: PointerEvent<HTMLSpanElement>): number | null => {
    const fraction = pointerFraction(
      event.clientX,
      event.currentTarget.getBoundingClientRect(),
    );
    return fraction === null ? null : scaleFromRatio(fraction);
  };

  const drop = () => {
    dragging.current = false;
    draftRef.current = null;
    setDraft(null);
  };

  const onPointerDown = (event: PointerEvent<HTMLSpanElement>) => {
    if (!interactive || event.button !== 0) {
      return;
    }
    const next = scaleAt(event);
    if (next === null) {
      return;
    }
    dragging.current = true;
    draftRef.current = next;
    setDraft(next);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent<HTMLSpanElement>) => {
    if (!dragging.current || !interactive) {
      return;
    }
    const next = scaleAt(event);
    if (next !== null) {
      draftRef.current = next;
      setDraft(next);
    }
  };

  const onPointerUp = (event: PointerEvent<HTMLSpanElement>) => {
    if (!dragging.current) {
      return;
    }
    const next = scaleAt(event) ?? draftRef.current;
    drop();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture?.(event.pointerId);
    }
    if (next !== null && interactive) {
      onChange(next);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLSpanElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
      return;
    }
    event.preventDefault();
    if (!interactive) {
      return;
    }
    const direction = event.key === "ArrowLeft" ? -1 : 1;
    if (!scaleAtBound(scale, direction)) {
      onChange(stepScale(scale, direction));
    }
  };

  return (
    <div className="mq-pp mq-pp-stepper" role="group" aria-label={label}>
      <PpIconButton
        size="M"
        icon="minus"
        label="Smaller"
        focused={focused === "smaller"}
        disabled={disabled || scaleAtBound(scale, -1)}
        pending={pending}
        onClick={() => onChange(stepScale(scale, -1))}
      />
      <span
        className="mq-pp-stepper-track"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        data-focusable={disabled ? undefined : true}
        data-focused={forcedFocus({ focused: focused === "slider", disabled, pending })}
        aria-label={label}
        aria-valuemin={MIN_PCT}
        aria-valuemax={MAX_PCT}
        aria-valuenow={Math.round(shown * 100)}
        aria-valuetext={formatScale(shown)}
        aria-disabled={interactive ? undefined : true}
        aria-busy={pending || undefined}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={drop}
        onLostPointerCapture={drop}
      >
        <span className="mq-pp-stepper-rail" aria-hidden="true">
          <span className="mq-pp-stepper-level" style={{ width: `${share * 100}%` }} />
        </span>
        <span
          className="mq-pp-stepper-knob"
          aria-hidden="true"
          style={{ left: `${share * 100}%` }}
        />
      </span>
      <PpIconButton
        size="M"
        icon="plus"
        label="Larger"
        focused={focused === "larger"}
        disabled={disabled || scaleAtBound(scale, 1)}
        pending={pending}
        onClick={() => onChange(stepScale(scale, 1))}
      />
      <output className="mq-pp-stepper-value" aria-live="polite">
        {formatScale(shown)}
      </output>
    </div>
  );
}
