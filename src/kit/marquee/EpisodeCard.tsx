import type { ComponentPropsWithRef } from "react";

import { CardFrame } from "./CardFrame";
import { CardProgress, WatchedMark } from "./CardMarks";
import { cardLabel, useArtChain } from "./cards";
import { useShownFocus } from "./controlsFocus";
import { cx } from "./cx";
import { Icon } from "./icons";

export type EpisodeCardProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "name" | "aria-label"
> & {
  /** The episode's name. */
  name: string;
  /** The episode as the Title numbers it, such as `S2E3` (`labelOf`). */
  code?: string | null;
  still?: string | null;
  watched?: boolean;
  progress?: number | null;
  /** Draw the focus treatment whatever the input modality says. */
  focused?: boolean;
};

/** The 408×230 episode still (sheet C3); focus adds the play mark. */
export function EpisodeCard({
  name,
  code,
  still,
  watched = false,
  progress,
  focused,
  className,
  type = "button",
  disabled,
  onFocus,
  onBlur,
  ...button
}: EpisodeCardProps) {
  const focus = useShownFocus<HTMLButtonElement>({
    focused: focused && !disabled,
    onFocus,
    onBlur,
  });
  const [art, fail] = useArtChain([still]);

  return (
    <button
      {...button}
      {...focus.focusProps}
      type={type}
      disabled={disabled}
      className={cx("mq-card", "mq-episode-card", className)}
      aria-label={cardLabel(code, name, watched && "Watched")}
      data-focusable
    >
      <CardFrame kind="episode" shown={focus.shown && !disabled}>
        {art ? (
          <img
            className="mq-card-art"
            src={art}
            alt=""
            loading="lazy"
            draggable={false}
            onError={() => fail(art)}
          />
        ) : (
          <span className="mq-card-plate">
            {code ? <span>{code}</span> : null}
            <span>{name}</span>
          </span>
        )}
        {watched ? <WatchedMark /> : null}
        <span className="mq-episode-card-play" aria-hidden="true">
          <Icon name="play" weight="fill" className="mq-episode-card-play-glyph" />
        </span>
        <CardProgress name={name} progress={progress} />
      </CardFrame>
    </button>
  );
}
