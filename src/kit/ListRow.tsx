import { useId, type ReactNode } from "react";

import { cx } from "./cx";
import { Icon, type IconName } from "./icons";
import { SwitchTrack } from "./Switch";

type Shared = {
  label: string;
  icon?: IconName;
  /** A second line under the label. */
  description?: string;
  /** Draw it focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/** A row that toggles: the whole row is the switch. */
type SwitchRow = Shared & {
  checked: boolean;
  onToggle: (next: boolean) => void;
  disabled?: boolean;
  value?: never;
  chevron?: never;
  onPress?: never;
  children?: never;
};

/** A row that opens something: a list of choices, a Level. */
type ValueRow = Shared & {
  /** What is chosen now. */
  value?: string;
  /** The trailing caret; drawn beside a value unless said otherwise. */
  chevron?: boolean;
  onPress?: () => void;
  disabled?: boolean;
  checked?: never;
  onToggle?: never;
  children?: never;
};

/** A row that carries the caller's own trailing controls, and is none itself. */
type SlotRow = Shared & {
  children: ReactNode;
  checked?: never;
  onToggle?: never;
  value?: never;
  chevron?: never;
  onPress?: never;
  disabled?: never;
};

export type ListRowProps = SwitchRow | ValueRow | SlotRow;

/**
 * A Settings or Addon option row. A value row opens a list; a switch row
 * toggles. Each is one control, so a press anywhere on it answers.
 */
export function ListRow(props: ListRowProps) {
  const { label, icon, description, focused, className } = props;
  const id = useId();
  const labelId = `${id}-label`;
  const descriptionId = description ? `${id}-description` : undefined;

  const lead = (
    <>
      {icon ? (
        <Icon name={icon} size="calc(var(--mq-u) * 26)" className="mq-c7-list-icon" />
      ) : null}
      <span className="mq-c7-list-text">
        <span id={labelId} className="mq-c7-list-label mq-c7-ellipsis">
          {label}
        </span>
        {description ? (
          <span id={descriptionId} className="mq-c7-list-description mq-c7-ellipsis">
            {description}
          </span>
        ) : null}
      </span>
    </>
  );
  const shared = {
    className: cx("mq-c7-list-row", className),
    "data-focused": (focused && !props.disabled) || undefined,
  };

  if (props.children !== undefined) {
    return (
      <div {...shared} role="group" aria-labelledby={labelId} aria-describedby={descriptionId}>
        {lead}
        <span className="mq-c7-list-trailing">{props.children}</span>
      </div>
    );
  }

  if (props.checked !== undefined) {
    const { checked, onToggle, disabled } = props;
    return (
      <button
        {...shared}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={descriptionId}
        data-focusable
        disabled={disabled}
        onClick={() => onToggle(!checked)}
      >
        {lead}
        <SwitchTrack checked={checked} />
      </button>
    );
  }

  const { value, onPress, disabled } = props;
  const chevron = props.chevron ?? value !== undefined;
  return (
    <button {...shared} type="button" data-focusable disabled={disabled} onClick={onPress}>
      {lead}
      {value !== undefined || chevron ? (
        <span className="mq-c7-list-trailing">
          {value !== undefined ? (
            <span className="mq-c7-list-value mq-c7-ellipsis">{value}</span>
          ) : null}
          {chevron ? (
            <Icon
              name="caret-right"
              size="calc(var(--mq-u) * 20)"
              className="mq-c7-list-chevron"
            />
          ) : null}
        </span>
      ) : null}
    </button>
  );
}
