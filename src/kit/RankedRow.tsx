import { useId } from "react";

import { cx } from "./cx";
import { FormsIconButton } from "./FormsButton";
import { useRowFocus } from "./useRowFocus";

export type RankedRowProps = {
  /** Its place in the order, counted from 1. */
  position: number;
  /** How many are in the order. */
  count: number;
  /** The language, in the list's own words. */
  label: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onRemove: () => void;
  /** OK on the row itself. */
  onPress?: () => void;
  /** Draw it focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/**
 * One of up to three languages, in the order the Host tries them: the position
 * in a lavender disc, the language, and up, down and remove. The ends of the
 * order refuse the move that would leave it, and a move that reaches one leaves
 * the focus on the row. The row is its own focus region.
 */
export function RankedRow({
  position,
  count,
  label,
  onMoveUp,
  onMoveDown,
  onRemove,
  onPress,
  focused,
  className,
}: RankedRowProps) {
  const id = useId();
  const rowFocus = useRowFocus();

  return (
    <div
      className={cx("mq-c7-ranked", className)}
      role="group"
      aria-label={label}
      data-focused={focused || undefined}
      data-region={`ranked:${id}`}
      data-kind="row"
      data-label={label}
      onFocus={rowFocus.onFocus}
      onBlur={rowFocus.onBlur}
    >
      <button
        ref={rowFocus.main}
        type="button"
        className="mq-c7-row-main"
        aria-label={`${position}. ${label}`}
        data-focusable
        onClick={onPress}
      >
        <span className="mq-c7-ranked-disc">{position}</span>
        <span className="mq-c7-ranked-label mq-c7-ellipsis">{label}</span>
      </button>
      <span className="mq-c7-row-actions">
        <FormsIconButton
          label="Move up"
          icon="arrow-up"
          disabled={position <= 1}
          onClick={onMoveUp}
        />
        <FormsIconButton
          label="Move down"
          icon="arrow-down"
          disabled={position >= count}
          onClick={onMoveDown}
        />
        <FormsIconButton label="Remove" icon="x" onClick={onRemove} />
      </span>
    </div>
  );
}
