/**
 * One choice in a player menu (sheet `C5`, 372×64): a title, an optional detail
 * line and, when chosen, a bold lavender check. Chosen and focused are separate
 * facts: a chosen row that also has focus keeps its check (§5).
 */

import { Icon } from "./icons";
import { forcedFocus, u } from "./ppParts";

export type TrackOptionProps = {
  title: string;
  /** Where the track came from, or its format: `In the file · SRT`. */
  detail?: string | null;
  selected?: boolean;
  focused?: boolean;
  disabled?: boolean;
  /** The Action this choice asked for is still in flight. */
  pending?: boolean;
  onSelect?: () => void;
};

export function TrackOption({
  title,
  detail,
  selected = false,
  focused,
  disabled,
  pending = false,
  onSelect,
}: TrackOptionProps) {
  return (
    <button
      type="button"
      className="mq-pp mq-pp-track"
      data-focusable
      data-focused={forcedFocus({ focused, disabled, pending })}
      data-selected={selected ? "true" : undefined}
      aria-pressed={selected}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      onClick={onSelect}
    >
      <span className="mq-pp-track-copy">
        <span className="mq-pp-track-title">{title}</span>
        {detail ? <span className="mq-pp-track-detail">{detail}</span> : null}
      </span>
      {selected ? (
        <Icon name="check" weight="bold" size={u(24)} className="mq-pp-track-check" />
      ) : null}
    </button>
  );
}
