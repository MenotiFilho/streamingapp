import { cx } from "./cx";

export type CategoryItemProps = {
  label: string;
  /** Whether this is the category on show. */
  active?: boolean;
  onPress: () => void;
  /** Draw it focused, for a caller that holds the focus itself. */
  focused?: boolean;
  className?: string;
};

/** One of the Settings categories. Active is lavender; focus is white. */
export function CategoryItem({
  label,
  active = false,
  onPress,
  focused,
  className,
}: CategoryItemProps) {
  return (
    <button
      type="button"
      className={cx("mq-c7-category", className)}
      aria-current={active ? "page" : undefined}
      data-focusable
      data-focused={focused || undefined}
      onClick={onPress}
    >
      {label}
    </button>
  );
}
