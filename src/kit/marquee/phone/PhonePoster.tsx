import { PhoneArt, PhoneProgress } from "./controls";

export type PhonePosterProps = {
  /** The Title's name: the accessible name, and the art's fallback. */
  name: string;
  poster?: string | null;
  /** Watch progress from 0 to 1, drawn along the bottom; absent draws none. */
  progress?: number | null;
  /** Draw the pressed state without a finger on it, for a still of the sheet. */
  pressed?: boolean;
  onPress: () => void;
};

/** A 116×174 poster; a pressed card darkens under the finger (sheet `C8`). */
export function PhonePoster({ name, poster, progress, pressed = false, onPress }: PhonePosterProps) {
  return (
    <button
      type="button"
      className="mq-ph mq-ph-poster mq-focus-art"
      data-focusable
      data-pressed={pressed || undefined}
      aria-label={name}
      onClick={onPress}
    >
      <span className="mq-ph-card-frame mq-art-frame">
        <PhoneArt
          src={poster}
          className="mq-ph-cover"
          fallback={<span className="mq-ph-plate">{name}</span>}
        />
        {typeof progress === "number" ? (
          <PhoneProgress ratio={progress} className="mq-ph-poster-progress" />
        ) : null}
      </span>
    </button>
  );
}
