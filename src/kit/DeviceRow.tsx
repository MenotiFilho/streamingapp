import { cx } from "./cx";
import { FormsButton } from "./FormsButton";
import { Icon } from "./icons";

export type DeviceRowProps = {
  /** The Device's name. */
  name: string;
  /** When it paired, and what else the caller can say: `Paired 12 Nov 2026`. */
  detail: string;
  onRevoke: () => void;
  /** Draw Revoke focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/** One paired Device. Revoking it stops it working and touches no other. */
export function DeviceRow({ name, detail, onRevoke, focused, className }: DeviceRowProps) {
  return (
    <div className={cx("mq-c7-device", className)} role="group" aria-label={name}>
      <span className="mq-c7-device-tile">
        <Icon name="device" size="calc(var(--mq-u) * 28)" />
      </span>
      <span className="mq-c7-device-text">
        <span className="mq-c7-device-name mq-c7-ellipsis">{name}</span>
        <span className="mq-c7-device-detail mq-c7-ellipsis">{detail}</span>
      </span>
      <FormsButton
        kind="secondary"
        size="M"
        focused={focused}
        aria-label={`Revoke ${name}`}
        onClick={onRevoke}
      >
        Revoke
      </FormsButton>
    </div>
  );
}
