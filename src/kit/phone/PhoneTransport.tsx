import { controlState, PhoneIconButton, type PhoneControlState } from "./controls";

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
  /** Each control's own refusal or wait, over and above `disabled`. */
  states?: Partial<Record<PhoneTransportButton, PhoneControlState>>;
};

export type PhoneTransportButton = "previous" | "back" | "toggle" | "forward" | "next";

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
  states = {},
}: PhoneTransportProps) {
  return (
    <div className="mq-ph-transport">
      <PhoneIconButton
        size="l"
        label="Previous episode"
        icon="skip-back"
        filled
        {...controlState(states.previous, disabled || !onPrevious)}
        onClick={onPrevious}
      />
      <PhoneIconButton
        size="l"
        label="Back 10 seconds"
        icon="rotate-ccw"
        {...controlState(states.back, disabled)}
        onClick={onBack}
      />
      <PhoneIconButton
        size="xl"
        kind="primary"
        label={playing ? "Pause" : "Play"}
        icon={playing ? "pause" : "play"}
        filled
        {...controlState(states.toggle, disabled)}
        onClick={onToggle}
      />
      <PhoneIconButton
        size="l"
        label="Forward 10 seconds"
        icon="rotate-cw"
        {...controlState(states.forward, disabled)}
        onClick={onForward}
      />
      <PhoneIconButton
        size="l"
        label="Next episode"
        icon="skip-forward"
        filled
        {...controlState(states.next, disabled || !onNext)}
        onClick={onNext}
      />
    </div>
  );
}
