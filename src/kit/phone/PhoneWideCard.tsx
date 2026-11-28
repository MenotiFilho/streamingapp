import { PhoneArt, PhoneBadge, PhoneProgress } from "./controls";

export type PhoneWideCardProps = {
  /** The Title's name: the accessible name, and the art's fallback. */
  name: string;
  /** The backdrop, or the episode's still. */
  art?: string | null;
  /** The Title's wordmark, drawn over the backdrop; a still carries none. */
  logo?: string | null;
  /** The accent mark of a Video that is Up next. */
  upNext?: boolean;
  /** Watch progress from 0 to 1; absent draws no track. */
  progress?: number | null;
  /** Draw the pressed state without a finger on it, for a still of the sheet. */
  pressed?: boolean;
  /** An unplayable Continue watching entry stays listed and cannot be pressed (ADR-0044 §2). */
  disabled?: boolean;
  testId?: string;
  onPress: () => void;
};

/** Continue watching at hand scale: 264×149 (sheet `C8`, "Wide card · phone"). */
export function PhoneWideCard({
  name,
  art,
  logo,
  upNext = false,
  progress,
  pressed = false,
  disabled = false,
  testId,
  onPress,
}: PhoneWideCardProps) {
  return (
    <button
      type="button"
      className="mq-ph mq-ph-wide mq-focus-art"
      data-focusable
      data-pressed={pressed || undefined}
      data-testid={testId}
      aria-label={upNext ? `${name}, Up next` : name}
      disabled={disabled}
      onClick={onPress}
    >
      <span className="mq-ph-card-frame mq-art-frame">
        <PhoneArt
          src={art}
          className="mq-ph-cover"
          fallback={<span className="mq-ph-plate">{name}</span>}
        />
        <span className="mq-ph-wide-scrim" aria-hidden="true" />
        <PhoneArt src={logo} className="mq-ph-wide-logo" />
        {upNext ? (
          <span className="mq-ph-wide-badge">
            <PhoneBadge tone="accent">UP NEXT</PhoneBadge>
          </span>
        ) : null}
        {typeof progress === "number" ? (
          <PhoneProgress ratio={progress} className="mq-ph-wide-progress" />
        ) : null}
      </span>
    </button>
  );
}
