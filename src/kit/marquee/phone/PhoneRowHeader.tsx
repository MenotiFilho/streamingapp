export type PhoneRowHeaderProps = {
  title: string;
  /** The Addon the row comes from, where it has one. */
  source?: string | null;
};

/** The head over a row (sheet `C8`, "Row header · phone"). */
export function PhoneRowHeader({ title, source }: PhoneRowHeaderProps) {
  return (
    <div className="mq-ph-row-head">
      <h2 className="mq-ph-row-title">{title}</h2>
      {source ? <span className="mq-ph-row-source">{source}</span> : null}
    </div>
  );
}
