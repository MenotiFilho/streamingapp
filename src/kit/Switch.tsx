import { cx } from "./cx";
import { PendingSpinner } from "./PendingSpinner";

export type SwitchProps = {
  /** Whether it is on, as the Host last said. */
  on: boolean;
  /** What it switches: the accessible name and the visible words. */
  label: string;
  /** Pressed: what the switch would become, for the Action it takes. */
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  /** Whether the Action this switch asked for is still in flight (#137). */
  pending?: boolean;
  testId?: string;
  className?: string;
};

/**
 * One labelled switch: a real button with `role="switch"`, drawn square and
 * hairline, with the brass thumb on the "on" side and a mono `On` / `Off` beside
 * it. The state is the Host's, not this control's: it never flips by itself, a
 * Snapshot does (ADR-0002).
 */
export function Switch({
  on,
  label,
  onToggle,
  disabled,
  pending = false,
  testId,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      aria-busy={pending || undefined}
      className={cx("rep-kit-switch", className)}
      data-focusable
      data-testid={testId}
      disabled={disabled || pending}
      onClick={() => onToggle(!on)}
    >
      <span className="rep-kit-switch-label">{label}</span>
      <span className="rep-kit-switch-state" aria-hidden="true">
        {on ? "On" : "Off"}
      </span>
      {pending ? (
        <PendingSpinner />
      ) : (
        <span className="rep-kit-switch-track" aria-hidden="true">
          <span className="rep-kit-switch-thumb" />
        </span>
      )}
    </button>
  );
}
