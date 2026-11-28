import { PhoneIconButton } from "./controls";

export type PhoneTransportProps = {
  /** Whether the Host is playing, so the centre says Pause. */
  playing: boolean;
  onToggle: () => void;
  onBack: () => void;
  onForward: () => void;
  /** Absent where there is no episode that way; the button keeps its place. */
  onPrevious?: () => void;
  onNext?: () => void;
  disabled?: boolean;
};

/**
 * Previous and next episode, ten seconds either way, and play/pause in lavender
 * (sheet `C8`, "Transport · phone").
 */
export function PhoneTransport({
  playing,
  onToggle,
  onBack,
  onForward,
  onPrevious,
  onNext,
  disabled = false,
}: PhoneTransportProps) {
  return (
    <div className="mq-ph-transport">
      <PhoneIconButton
        size="l"
        label="Previous episode"
        icon="skip-back"
        filled
        disabled={disabled || !onPrevious}
        onClick={onPrevious}
      />
      <PhoneIconButton
        size="l"
        label="Back 10 seconds"
        icon="rotate-ccw"
        disabled={disabled}
        onClick={onBack}
      />
      <PhoneIconButton
        size="xl"
        kind="primary"
        label={playing ? "Pause" : "Play"}
        icon={playing ? "pause" : "play"}
        filled
        disabled={disabled}
        onClick={onToggle}
      />
      <PhoneIconButton
        size="l"
        label="Forward 10 seconds"
        icon="rotate-cw"
        disabled={disabled}
        onClick={onForward}
      />
      <PhoneIconButton
        size="l"
        label="Next episode"
        icon="skip-forward"
        filled
        disabled={disabled || !onNext}
        onClick={onNext}
      />
    </div>
  );
}
