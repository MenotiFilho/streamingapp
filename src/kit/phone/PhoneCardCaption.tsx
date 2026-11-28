export type PhoneCardCaptionProps = {
  title: string;
  /** The second line: the time left, or Up next. */
  note?: string | null;
};

/** The name and note under a wide card (sheet `C8`, "Card caption · phone"). */
export function PhoneCardCaption({ title, note }: PhoneCardCaptionProps) {
  return (
    <div className="mq-ph-caption">
      <p className="mq-ph-caption-title">{title}</p>
      {note ? <p className="mq-ph-caption-note">{note}</p> : null}
    </div>
  );
}
