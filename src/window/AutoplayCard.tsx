import type { Ref } from "react";

import type { AutoplayView } from "../core/autoplay";
import { Button } from "../kit/Button";

type Card = Extract<AutoplayView, { kind: "countdown" | "still_watching" }>;

/**
 * The Host's countdown, drawn bottom-right on the Picture: the next episode's
 * still with the digit over it, "Up next · S1E4", its name, **Play now**,
 * **Cancel**, and a brass line draining along the foot (#302, #287).
 *
 * At the unattended limit it is the same card in the same place, titled "Still
 * watching?": the still and the name, no digit and no line, and one primary
 * **Keep watching** (#319).
 *
 * It does not depend on the OSD's idle clock: it is the one thing on the ended
 * Picture asking to be read, so it stays while the OSD is pinned beside it. The
 * view is the core's projection; this draws it and sends two Actions, which the
 * player owns.
 */
export function AutoplayCard({
  view,
  focus,
  stepping,
  onPlayNow,
  onCancel,
}: {
  view: Card;
  /**
   * Where focus lands when the card appears: **Cancel** while it counts down,
   * the one **Keep watching** at the hold.
   */
  focus: Ref<HTMLButtonElement>;
  /** Whether the episode step Play now and Keep watching take is still in flight. */
  stepping: boolean;
  /** **Play now**, or **Keep watching**: `next_episode` either way. */
  onPlayNow: () => void;
  onCancel: () => void;
}) {
  const { next } = view;
  const counting = view.kind === "countdown";
  const lead = counting ? view.kicker.lead : view.title;
  const label = counting ? view.kicker.text : view.strip;

  return (
    <aside
      className="rep-autoplay-card"
      role="group"
      aria-label={label}
      data-testid="autoplay-card"
      data-region="autoplay-card"
      data-kind="row"
      data-label="Up next"
    >
      <div className="rep-autoplay-still">
        {next.still ? <img className="rep-autoplay-still-art" src={next.still} alt="" /> : null}
        {counting ? (
          <span
            className="rep-autoplay-digit tabular"
            data-testid="autoplay-digit"
            aria-hidden="true"
          >
            {view.digit}
          </span>
        ) : null}
      </div>
      <div className="rep-autoplay-copy">
        <p className="rep-autoplay-kicker">
          <span>{lead}</span>
          <span className="rep-autoplay-kicker-rule" aria-hidden="true" />
          <span>{next.label}</span>
        </p>
        {next.name ? (
          <p className="rep-autoplay-name" data-testid="autoplay-name">
            {next.name}
          </p>
        ) : null}
        <div className="rep-autoplay-actions">
          {counting ? (
            <>
              <Button
                variant="primary"
                data-testid="autoplay-play-now"
                disabled={stepping}
                pending={stepping}
                onClick={onPlayNow}
              >
                Play now
              </Button>
              <Button ref={focus} variant="ghost" data-testid="autoplay-cancel" onClick={onCancel}>
                Cancel
              </Button>
            </>
          ) : (
            <Button
              ref={focus}
              variant="primary"
              data-testid="autoplay-keep-watching"
              disabled={stepping}
              pending={stepping}
              onClick={onPlayNow}
            >
              Keep watching
            </Button>
          )}
        </div>
      </div>
      {counting ? (
        <span className="rep-autoplay-drain" aria-hidden="true">
          <span style={{ width: `${view.fraction * 100}%` }} />
        </span>
      ) : null}
    </aside>
  );
}
