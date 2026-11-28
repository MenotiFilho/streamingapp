import { cx } from "./cx";
import { FormsButton } from "./FormsButton";
import { Icon, type IconName } from "./icons";

export type EmptyStateProps = {
  icon?: IconName;
  title: string;
  /** One line saying what would be here, or what to do. */
  body: string;
  /** The one thing a person can do from here. */
  action?: {
    label: string;
    icon?: IconName;
    onPress: () => void;
  };
  /** Draw the action focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/**
 * An empty list, or a failure that leaves a screen with nothing to show: a
 * glyph disc, a title, one line and one action, centred.
 */
export function EmptyState({
  icon = "film",
  title,
  body,
  action,
  focused,
  className,
}: EmptyStateProps) {
  return (
    <div className={cx("mq-c7-empty", className)}>
      <span className="mq-c7-empty-disc">
        <Icon name={icon} size="calc(var(--mq-u) * 38)" />
      </span>
      <h2 className="mq-c7-empty-title">{title}</h2>
      <p className="mq-c7-empty-body">{body}</p>
      {action ? (
        <FormsButton
          kind="primary"
          size="L"
          icon={action.icon}
          focused={focused}
          onClick={action.onPress}
        >
          {action.label}
        </FormsButton>
      ) : null}
    </div>
  );
}
