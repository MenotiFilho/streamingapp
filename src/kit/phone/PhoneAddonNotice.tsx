import { Icon } from "../icons";
import { PhoneIconButton } from "./controls";

export type PhoneAddonNoticeProps = {
  /** Which Addon did not answer, in the client's words. */
  title: string;
  /** The Host's own reason, verbatim. */
  reason: string;
  /** Ask that Addon again, where the client can. */
  onRetry?: () => void;
  disabled?: boolean;
};

/** An Addon that did not answer (sheet `C8`, "Addon notice · phone"). */
export function PhoneAddonNotice({ title, reason, onRetry, disabled = false }: PhoneAddonNoticeProps) {
  return (
    <div className="mq-ph-notice" role="status">
      <Icon name="triangle-alert" size={22} className="mq-ph-notice-icon" />
      <span className="mq-ph-notice-copy">
        <span className="mq-ph-notice-title">{title}</span>
        <span className="mq-ph-notice-reason">{reason}</span>
      </span>
      {onRetry ? (
        <PhoneIconButton
          className="mq-ph-notice-retry"
          kind="secondary"
          label="Try again"
          icon="arrow-clockwise"
          disabled={disabled}
          onClick={onRetry}
        />
      ) : null}
    </div>
  );
}
