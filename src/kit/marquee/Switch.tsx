import { cx } from "./cx";

export type SwitchProps = {
  /** Whether it is on, as the Host last said. */
  checked: boolean;
  /** Pressed: what the switch would become, for the Action it takes. */
  onChange: (next: boolean) => void;
  /** The accessible name: what it switches. */
  label: string;
  disabled?: boolean;
  /** Draw it focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/** The 60x34 drawing alone, for a row that is itself the switch. */
export function SwitchTrack({ checked }: { checked: boolean }) {
  return (
    <span className="mq-c7-switch-track" data-on={checked} aria-hidden="true">
      <span className="mq-c7-switch-knob" />
    </span>
  );
}

/**
 * The Marquee switch: lavender with an ink knob when on. A native button, so
 * Space and Enter press it without a key handler of its own. The state is the
 * Host's: it never flips by itself, a Snapshot does (ADR-0002).
 */
export function Switch({ checked, onChange, label, disabled, focused, className }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx("mq-c7-switch", className)}
      data-focusable
      data-focused={(focused && !disabled) || undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <SwitchTrack checked={checked} />
    </button>
  );
}
