/**
 * The wait over a Stalled picture (sheet `C6`, 72×72): a lavender third of a
 * ring turning on a faint one. Under reduced motion it holds still and fades
 * in and out instead (ADR-0031 §5).
 */

import { STALLED_NOTE } from "../../core/stall";

/** The ring's middle radius and width inside the 72-unit box. */
const RADIUS = 33;
const STROKE = 6;
const TURN = 2 * Math.PI * RADIUS;

export function Spinner({ label = STALLED_NOTE }: { label?: string }) {
  return (
    <span className="mq-pp mq-pp-spinner" role="status" aria-label={label}>
      <svg viewBox="0 0 72 72" aria-hidden="true" focusable="false">
        <circle
          className="mq-pp-spinner-track"
          cx="36"
          cy="36"
          r={RADIUS}
          strokeWidth={STROKE}
        />
        <circle
          className="mq-pp-spinner-arc"
          cx="36"
          cy="36"
          r={RADIUS}
          strokeWidth={STROKE}
          strokeDasharray={`${TURN / 3} ${TURN}`}
          transform="rotate(-90 36 36)"
        />
      </svg>
    </span>
  );
}
