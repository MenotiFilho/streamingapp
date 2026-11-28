import { PhoneIconButton } from "./controls";

export type PhoneHeaderProps = {
  /** The level's name. */
  title: string;
  /** What it is a level of. */
  subtitle?: string | null;
  onBack: () => void;
};

/**
 * A pushed level's head (sheet `C8`, "Header · phone"): Back and the name. Its
 * top 48px is the status bar's room, or the safe area where that is taller.
 */
export function PhoneHeader({ title, subtitle, onBack }: PhoneHeaderProps) {
  return (
    <header className="mq-ph-header">
      <PhoneIconButton className="mq-ph-header-back" label="Back" icon="arrow-left" onClick={onBack} />
      <h1 className="mq-ph-header-title">{title}</h1>
      {subtitle ? <p className="mq-ph-header-subtitle">{subtitle}</p> : null}
    </header>
  );
}
