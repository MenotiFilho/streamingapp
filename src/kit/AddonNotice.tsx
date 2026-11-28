/**
 * An Addon that failed, inside the list it failed to fill (sheet `C5`, 848×76):
 * the danger tint, which Addon did not answer, the Host's reason verbatim, and
 * **Try again**.
 */

import { Icon } from "./icons";
import { PpButton, u } from "./ppParts";

export type AddonNoticeProps = {
  /** The Addon's name, as its Manifest spells it. */
  addon: string;
  /** The Host's reason, such as `addon_unreachable`; never re-worded. */
  reason: string;
  onRetry?: () => void;
  retryLabel?: string;
  /** The retry is still in flight. */
  pending?: boolean;
  focused?: boolean;
};

export function AddonNotice({
  addon,
  reason,
  onRetry,
  retryLabel = "Try again",
  pending,
  focused,
}: AddonNoticeProps) {
  return (
    <div className="mq-pp mq-pp-notice">
      <Icon name="triangle-alert" size={u(24)} className="mq-pp-notice-icon" />
      <div className="mq-pp-notice-copy" role="status">
        <p className="mq-pp-notice-title">{`${addon} did not answer`}</p>
        <p className="mq-pp-notice-reason">{reason}</p>
      </div>
      {onRetry ? (
        <PpButton
          icon="arrow-clockwise"
          pending={pending}
          focused={focused}
          onClick={onRetry}
        >
          {retryLabel}
        </PpButton>
      ) : null}
    </div>
  );
}
