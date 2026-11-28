import { PhoneArt, PhoneIconButton, PhoneProgress } from "./controls";

export type NowPlayingStripProps = {
  /** The Title's name. */
  title: string;
  /** The episode and the time left, in the client's words. */
  note: string;
  /** The Title's poster, never a frame of what is playing. */
  poster?: string | null;
  /** Whether the Host is playing, so the toggle says Pause. */
  playing: boolean;
  /** How far in, from 0 to 1. */
  progress: number;
  /** A tap anywhere but the two controls opens the full remote. */
  onOpen: () => void;
  onBack: () => void;
  onToggle: () => void;
  /** Whether the transport cannot be pressed, as while a Stream is opening. */
  disabled?: boolean;
};

/**
 * What the Host plays, over the bottom index (sheet `C8`, "Now playing strip").
 * It is 64px tall and as wide as its parent; the screen places it 8px from the
 * edges and above the tab bar.
 */
export function NowPlayingStrip({
  title,
  note,
  poster,
  playing,
  progress,
  onOpen,
  onBack,
  onToggle,
  disabled = false,
}: NowPlayingStripProps) {
  return (
    <div className="mq-ph-strip">
      <button
        type="button"
        className="mq-ph mq-ph-strip-open mq-focus-row"
        data-focusable
        aria-label={`Open the remote, ${title}, ${note}`}
        onClick={onOpen}
      >
        <span className="mq-ph-strip-poster">
          <PhoneArt src={poster} className="mq-ph-cover" />
        </span>
        <span className="mq-ph-strip-title">{title}</span>
        <span className="mq-ph-strip-note">{note}</span>
      </button>
      <PhoneIconButton
        className="mq-ph-strip-back"
        label="Back 10 seconds"
        icon="rotate-ccw"
        disabled={disabled}
        onClick={onBack}
      />
      <PhoneIconButton
        className="mq-ph-strip-toggle"
        label={playing ? "Pause" : "Play"}
        icon={playing ? "pause" : "play"}
        filled
        disabled={disabled}
        onClick={onToggle}
      />
      <PhoneProgress ratio={progress} className="mq-ph-strip-progress" />
    </div>
  );
}
