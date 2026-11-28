/**
 * Subtitle timing (sheet `C6`, 352×48): −0.1 s, the signed delay, +0.1 s and
 * **Reset**. The delay is the Host's, per Stream (ADR-0044 §4).
 *
 * A step asks for an absolute delay, one tenth from `seconds`. Presses made
 * before a newer Snapshot moves `seconds` therefore ask for the same value,
 * which a client's door joins while it is in flight (ADR-0027): they move one
 * tenth, not one per press. The buttons take no pending state.
 */

import { DELAY_STEP, formatDelay, stepDelay } from "../core/controls";
import { PpButton } from "./ppParts";

export type SyncControlButton = "earlier" | "later" | "reset";

export type SyncControlProps = {
  seconds: number;
  /** The delay asked for, in seconds; Reset asks for `0`. */
  onChange: (seconds: number) => void;
  label?: string;
  disabled?: boolean;
  focused?: SyncControlButton;
};

export function SyncControl({
  seconds,
  onChange,
  label = "Subtitle sync",
  disabled,
  focused,
}: SyncControlProps) {
  return (
    <div className="mq-pp mq-pp-sync" role="group" aria-label={label}>
      <PpButton
        className="mq-pp-sync-step"
        focused={focused === "earlier"}
        disabled={disabled}
        onClick={() => onChange(stepDelay(seconds, -DELAY_STEP))}
      >
        −0.1 s
      </PpButton>
      <output className="mq-pp-sync-value" aria-live="polite">
        {formatDelay(seconds)}
      </output>
      <PpButton
        className="mq-pp-sync-step"
        focused={focused === "later"}
        disabled={disabled}
        onClick={() => onChange(stepDelay(seconds, DELAY_STEP))}
      >
        +0.1 s
      </PpButton>
      <PpButton
        kind="ghost"
        className="mq-pp-sync-reset"
        focused={focused === "reset"}
        disabled={disabled}
        onClick={() => onChange(0)}
      >
        Reset
      </PpButton>
    </div>
  );
}
