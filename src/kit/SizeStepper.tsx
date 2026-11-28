/**
 * The Subtitle size stepper (sheet `C6`, 352×48): minus, a track with a
 * lavender level and a knob, plus, and the value. 25% to 300% in 5% steps
 * (ADR-0044 §5), on the core's ladder; a button at its bound is disabled.
 */

import { formatScale, scaleAtBound, stepScale } from "../core/controls";
import { PpIconButton } from "./ppParts";
import { sizeFraction } from "./sizeScale";

export type SizeStepperControl = "smaller" | "larger";

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

export function SizeStepper({
  scale,
  onChange,
  label = "Subtitle size",
  disabled = false,
  pending = false,
  focused,
}: SizeStepperProps) {
  const share = sizeFraction(scale);

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
      <span className="mq-pp-stepper-track" aria-hidden="true">
        <span className="mq-pp-stepper-level" style={{ width: `${share * 100}%` }} />
        <span className="mq-pp-stepper-knob" style={{ left: `${share * 100}%` }} />
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
        {formatScale(scale)}
      </output>
    </div>
  );
}
