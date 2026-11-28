import type { ComponentPropsWithRef } from "react";

import { Badge } from "./Badge";
import { CardFrame } from "./CardFrame";
import { CardProgress, WatchedMark } from "./CardMarks";
import { cardLabel, useArtChain } from "./cards";
import { useShownFocus } from "./controlsFocus";
import { cx } from "./cx";

export type PosterProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "name" | "aria-label"
> & {
  /** The Title's name: the accessible name, and what is drawn without art. */
  name: string;
  poster?: string | null;
  watched?: boolean;
  /**
   * A Title the Host cannot play: marked in words and dimmed. It stays
   * pressable unless the caller disables it (ADR-0020).
   */
  unplayable?: boolean;
  /** How far through the Title the owner is, from 0 to 1; absent draws no bar. */
  progress?: number | null;
  /** Draw the focus treatment whatever the input modality says. */
  focused?: boolean;
};

/** The 208×312 poster card of a Catalog row (sheet C3). */
export function Poster({
  name,
  poster,
  watched = false,
  unplayable = false,
  progress,
  focused,
  className,
  type = "button",
  disabled,
  onFocus,
  onBlur,
  ...button
}: PosterProps) {
  const focus = useShownFocus<HTMLButtonElement>({
    focused: focused && !disabled,
    onFocus,
    onBlur,
  });
  const [art, fail] = useArtChain([poster]);

  return (
    <button
      {...button}
      {...focus.focusProps}
      type={type}
      disabled={disabled}
      className={cx("mq-card", "mq-poster", className)}
      aria-label={cardLabel(name, watched && "Watched", unplayable && "Unplayable")}
      data-focusable
      data-unplayable={unplayable || undefined}
    >
      <CardFrame kind="poster" shown={focus.shown && !disabled}>
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
          <span className="mq-card-plate">{name}</span>
        )}
        {watched ? <WatchedMark /> : null}
        {unplayable ? (
          <Badge tone="danger" className="mq-poster-badge">
            UNPLAYABLE
          </Badge>
        ) : null}
        <CardProgress name={name} progress={progress} />
      </CardFrame>
    </button>
  );
}
