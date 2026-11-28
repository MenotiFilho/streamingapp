import { PhoneArt, PhoneProgress } from "./controls";

export type PhoneEpisodeRowProps = {
  /** The overline: the episode and its length, or that it is playing. */
  number: string;
  title: string;
  /** The air date, as the client words it. */
  date?: string | null;
  /** The episode's own description, two lines at most. */
  description?: string | null;
  still?: string | null;
  /** What the empty still says, such as `S2E3`. */
  code?: string | null;
  /** Watch progress from 0 to 1; absent draws none. */
  progress?: number | null;
  /** A tap opens what the episode opens. */
  onPress: () => void;
};

/** The Title page's episode row (sheet `C8`, "Episode row · phone"). */
export function PhoneEpisodeRow({
  number,
  title,
  date,
  description,
  still,
  code,
  progress,
  onPress,
}: PhoneEpisodeRowProps) {
  return (
    <button
      type="button"
      className="mq-ph mq-ph-episode mq-focus-row"
      data-focusable
      data-described={Boolean(description)}
      onClick={onPress}
    >
      <span className="mq-ph-episode-head">
        <span className="mq-ph-episode-still">
          <PhoneArt
            src={still}
            className="mq-ph-cover"
            fallback={<span className="mq-ph-plate">{code ?? title}</span>}
          />
          {typeof progress === "number" ? (
            <PhoneProgress ratio={progress} className="mq-ph-episode-progress" />
          ) : null}
        </span>
        <span className="mq-ph-episode-number">{number}</span>
        <span className="mq-ph-episode-title">{title}</span>
        {date ? <span className="mq-ph-episode-date">{date}</span> : null}
      </span>
      {description ? <span className="mq-ph-episode-description">{description}</span> : null}
    </button>
  );
}
