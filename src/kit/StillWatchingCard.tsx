/**
 * The hold Autoplay takes after three episodes nobody touched (sheet `C6`,
 * 560×288): only **Keep watching** moves on, and **Stop** ends playback.
 */

import { PpButton } from "./ppParts";

export type StillWatchingControl = "keep" | "stop";

export type StillWatchingCardProps = {
  /** The episode waiting: `S2 E5 · Trojan’s Horse`. */
  next: string;
  onKeepWatching: () => void;
  onStop: () => void;
  title?: string;
  overline?: string;
  /** The step Keep watching takes is still in flight. */
  pending?: boolean;
  focused?: StillWatchingControl;
};

export function StillWatchingCard({
  next,
  onKeepWatching,
  onStop,
  title = "Still watching?",
  overline = "Three episodes in a row",
  pending,
  focused,
}: StillWatchingCardProps) {
  return (
    <div className="mq-pp mq-pp-card mq-pp-still" role="group" aria-label={title}>
      <p className="mq-pp-still-overline">{overline}</p>
      <h2 className="mq-pp-still-title">{title}</h2>
      <p className="mq-pp-still-next">{`Next: ${next}`}</p>
      <div className="mq-pp-still-actions">
        <PpButton
          kind="primary"
          size="L"
          icon="play"
          iconWeight="fill"
          focused={focused === "keep"}
          pending={pending}
          onClick={onKeepWatching}
        >
          Keep watching
        </PpButton>
        <PpButton
          size="L"
          icon="stop"
          iconWeight="fill"
          focused={focused === "stop"}
          onClick={onStop}
        >
          Stop
        </PpButton>
      </div>
    </div>
  );
}
