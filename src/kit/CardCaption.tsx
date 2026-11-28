import { cx } from "./cx";

export type CardCaptionProps = {
  title: string;
  /** The line under it, such as the time left. */
  note?: string | null;
  className?: string;
};

/**
 * The two lines under a wide card (sheet C3). Placed straight after a card, it
 * moves down by the card's growth while that card shows focus.
 */
export function CardCaption({ title, note, className }: CardCaptionProps) {
  return (
    <div className={cx("mq-card-caption", className)}>
      <p className="mq-card-caption-title">{title}</p>
      {note ? <p className="mq-card-caption-note">{note}</p> : null}
    </div>
  );
}
