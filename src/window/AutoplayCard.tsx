import type { Ref } from "react";

import type { AutoplayView } from "../core/autoplay";
import { Button } from "../kit/Button";

type Countdown = Extract<AutoplayView, { kind: "countdown" }>;

/**
 * The Host's countdown, drawn bottom-right on the Picture: the next episode's
 * still with the digit over it, "Up next · S1E4", its name, **Play now**,
 * **Cancel**, and a brass line draining along the foot (#302, #287).
 *
 * It does not depend on the OSD's idle clock: it is the one thing on the ended
 * Picture asking to be read, so it stays while the OSD is pinned beside it. The
 * view is the core's projection; this draws it and sends two Actions, which the
 * player owns.
 */
export function AutoplayCard({
  view,
  cancel,
  stepping,
  onPlayNow,
  onCancel,
}: {
  view: Countdown;
  /** Where **Cancel** lives, so the player can put focus there when the card appears. */
  cancel: Ref<HTMLButtonElement>;
  /** Whether the episode step Play now takes is still in flight. */
  stepping: boolean;
  onPlayNow: () => void;
  onCancel: () => void;
}) {
  const { next, kicker } = view;

  return (
    <aside
      className="rep-autoplay-card"
      role="group"
      aria-label={kicker.text}
      data-testid="autoplay-card"
      data-region="autoplay-card"
      data-kind="row"
      data-label="Up next"
    >
      <div className="rep-autoplay-still">
        {next.still ? <img className="rep-autoplay-still-art" src={next.still} alt="" /> : null}
        <span className="rep-autoplay-digit tabular" data-testid="autoplay-digit" aria-hidden="true">
          {view.digit}
        </span>
      </div>
      <div className="rep-autoplay-copy">
        <p className="rep-autoplay-kicker">
          <span>{kicker.lead}</span>
          <span className="rep-autoplay-kicker-rule" aria-hidden="true" />
          <span>{kicker.episode}</span>
        </p>
        {next.name ? (
          <p className="rep-autoplay-name" data-testid="autoplay-name">
            {next.name}
          </p>
        ) : null}
        <div className="rep-autoplay-actions">
          <Button
            variant="primary"
            data-testid="autoplay-play-now"
            disabled={stepping}
            pending={stepping}
            onClick={onPlayNow}
          >
            Play now
          </Button>
          <Button ref={cancel} variant="ghost" data-testid="autoplay-cancel" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </div>
      <span className="rep-autoplay-drain" aria-hidden="true">
        <span style={{ width: `${view.fraction * 100}%` }} />
      </span>
    </aside>
  );
}
