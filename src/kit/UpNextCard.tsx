/**
 * The countdown to the next episode (sheet `C6`, 560×372), drawn bottom right:
 * the still, the seconds left, the episode, **Play now**, **Cancel** and a
 * lavender line that runs out as the countdown does.
 *
 * The numbers are the core's projection of the Host's countdown
 * (`autoplayView`): `secondsLeft` its digit and `fraction` what is left.
 * Focus belongs to the client that puts the card up.
 */

import { PpButton } from "./ppParts";

export type UpNextControl = "play" | "cancel";

export type UpNextCardProps = {
  /** Which episode: `S2 E4`. */
  episode: string;
  name?: string | null;
  /** The next episode's still; without one the card shows its surface. */
  still?: string | null;
  secondsLeft: number;
  /** What is left of the countdown, 1 at its start to 0. */
  fraction: number;
  onPlayNow: () => void;
  onCancel: () => void;
  /** The step Play now takes is still in flight. */
  pending?: boolean;
  focused?: UpNextControl;
};

export function UpNextCard({
  episode,
  name,
  still,
  secondsLeft,
  fraction,
  onPlayNow,
  onCancel,
  pending,
  focused,
}: UpNextCardProps) {
  const title = name ? `${episode} · ${name}` : episode;
  const left = Math.min(1, Math.max(0, Number.isFinite(fraction) ? fraction : 0));

  return (
    <div className="mq-pp mq-pp-card mq-pp-upnext" role="group" aria-label={`Up next: ${title}`}>
      {still ? (
        <img className="mq-pp-upnext-still" src={still} alt="" />
      ) : (
        <span className="mq-pp-upnext-still mq-surface-2" aria-hidden="true" />
      )}
      <span className="mq-pp-upnext-scrim" aria-hidden="true" />
      <p className="mq-pp-upnext-countdown">{`Up next in ${secondsLeft}`}</p>
      <h2 className="mq-pp-upnext-title">{title}</h2>
      <div className="mq-pp-upnext-actions">
        <PpButton
          kind="primary"
          icon="play"
          iconWeight="fill"
          focused={focused === "play"}
          pending={pending}
          onClick={onPlayNow}
        >
          Play now
        </PpButton>
        <PpButton focused={focused === "cancel"} onClick={onCancel}>
          Cancel
        </PpButton>
      </div>
      <span
        className="mq-pp-upnext-bar"
        aria-hidden="true"
        style={{ width: `${left * 100}%` }}
      />
    </div>
  );
}
