import { PhoneSwitchMark } from "./controls";

export type PhoneSwitchRowProps = {
  label: string;
  /** What the Host last said. */
  checked: boolean;
  /** What a press would make it: the control never flips by itself. */
  onChange: (next: boolean) => void;
  disabled?: boolean;
};

/** A labelled switch, such as Autoplay on the remote (sheet `C8`). */
export function PhoneSwitchRow({ label, checked, onChange, disabled = false }: PhoneSwitchRowProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className="mq-ph mq-ph-switch-row mq-focus-row"
      data-focusable
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="mq-ph-switch-row-label">{label}</span>
      <PhoneSwitchMark on={checked} />
    </button>
  );
}
