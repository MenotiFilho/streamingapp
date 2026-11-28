import { cx } from "./cx";
import { Icon } from "./icons";

export type BrandMarkProps = {
  className?: string;
  /** Names the mark where it stands alone; without one it is decoration. */
  label?: string;
};

/** The 48px brand mark of sheet C2: an ink play glyph on a lavender tile. */
export function BrandMark({ className, label }: BrandMarkProps) {
  return (
    <span
      className={cx("mq-brand-mark", className)}
      {...(label ? { role: "img", "aria-label": label } : { "aria-hidden": true })}
    >
      <Icon name="play" weight="fill" className="mq-brand-mark-glyph" />
    </span>
  );
}
