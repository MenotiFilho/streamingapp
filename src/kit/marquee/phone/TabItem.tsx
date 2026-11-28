import { Icon, type IconName } from "../icons";

export type TabItemProps = {
  icon: IconName;
  label: string;
  /** The destination the person is in: lavender, with a pill behind the glyph. */
  active?: boolean;
  /** Draw the pressed state without a finger on it, for a still of the sheet. */
  pressed?: boolean;
  onPress?: () => void;
};

/** One 65×64 destination of the bottom index (sheet `C8`, "Tab item"). */
export function TabItem({ icon, label, active = false, pressed = false, onPress }: TabItemProps) {
  return (
    <button
      type="button"
      className="mq-ph mq-ph-tab mq-focus-row"
      data-focusable
      data-active={active}
      data-pressed={pressed || undefined}
      aria-current={active ? "page" : undefined}
      onClick={onPress}
    >
      <span className="mq-ph-tab-glyph">
        <Icon name={icon} weight={active ? "fill" : "regular"} size={24} />
      </span>
      <span className="mq-ph-tab-label">{label}</span>
    </button>
  );
}
