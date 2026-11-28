import { PhoneBadge } from "./controls";

export type PhoneStreamRowProps = {
  /** The tier box's colour: lavender for 4K, surface for anything under it. */
  tier: "4k" | "hd";
  /** The tier box's words, such as `4K` or `1080p`. */
  quality: string;
  /** The Stream's name, verbatim as the Addon gave it. */
  name: string;
  /** Peers, size and source. */
  details?: string | null;
  /** The marks the name declares, verbatim. */
  marks?: readonly string[];
  /** The Stream playing now: a lavender outline, and PLAYING in place of the second mark. */
  playing?: boolean;
  /** A Stream this Host cannot open stays in the list and cannot be pressed. */
  disabled?: boolean;
  /** A tap plays it on the Host. */
  onPlay: () => void;
};

/** One candidate of the Streams list, 112px (sheet `C8`, "Stream row · phone"). */
export function PhoneStreamRow({
  tier,
  quality,
  name,
  details,
  marks = [],
  playing = false,
  disabled = false,
  onPlay,
}: PhoneStreamRowProps) {
  // PLAYING takes the second mark's place, so the row keeps its one line.
  const words = playing ? marks.filter((_, index) => index !== 1) : marks;
  const badges = words.map((mark, index) => <PhoneBadge key={index}>{mark}</PhoneBadge>);

  return (
    <button
      type="button"
      className="mq-ph mq-ph-stream mq-focus-row"
      data-focusable
      data-playing={playing || undefined}
      aria-current={playing ? "true" : undefined}
      disabled={disabled}
      onClick={onPlay}
    >
      <span className="mq-ph-stream-tier" data-tier={tier}>
        {quality}
      </span>
      <span className="mq-ph-stream-name">{name}</span>
      {details ? <span className="mq-ph-stream-details">{details}</span> : null}
      <span className="mq-ph-stream-marks">
        {badges.slice(0, 1)}
        {playing ? <PhoneBadge tone="accent">PLAYING</PhoneBadge> : null}
        {badges.slice(1)}
      </span>
    </button>
  );
}
