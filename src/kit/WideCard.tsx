import type { ComponentPropsWithRef } from "react";

import { Badge } from "./Badge";
import { CardFrame } from "./CardFrame";
import { CardProgress } from "./CardMarks";
import {
  cardLabel,
  unplayableWords,
  useArtChain,
  wideCardBadge,
  type CardUnplayableReason,
} from "./cards";
import { useShownFocus } from "./controlsFocus";
import { cx } from "./cx";

export type WideCardProps = Omit<
  ComponentPropsWithRef<"button">,
  "children" | "name" | "aria-label"
> & {
  /** The Title's name: the accessible name, and the fallback for logo and art. */
  name: string;
  /** The Title's 16:9 backdrop, drawn with the logo over it. */
  backdrop?: string | null;
  /** An episode still, drawn without a logo; the art when no backdrop loads. */
  still?: string | null;
  /** The Title's wordmark; without one the name is set over the backdrop. */
  logo?: string | null;
  progress?: number | null;
  upNext?: boolean;
  /** An entry the Host will not play: listed, marked, dimmed and not pressable. */
  unplayable?: CardUnplayableReason | null;
  /** Draw the focus treatment whatever the input modality says. */
  focused?: boolean;
};

/** The 400×225 Continue watching card (sheet C3). */
export function WideCard({
  name,
  backdrop,
  still,
  logo,
  progress,
  upNext = false,
  unplayable = null,
  focused,
  className,
  type = "button",
  disabled,
  onFocus,
  onBlur,
  ...button
}: WideCardProps) {
  const unavailable = disabled === true || unplayable !== null;
  const focus = useShownFocus<HTMLButtonElement>({
    focused: focused && !unavailable,
    onFocus,
    onBlur,
  });
  const [art, failArt] = useArtChain([backdrop, still]);
  const [wordmark, failLogo] = useArtChain([logo]);
  const badge = wideCardBadge({ upNext, unplayable });

  return (
    <button
      {...button}
      {...focus.focusProps}
      type={type}
      disabled={unavailable}
      className={cx("mq-card", "mq-wide-card", className)}
      aria-label={cardLabel(
        name,
        badge === "up-next" && "Up next",
        unplayable && `Unplayable: ${unplayableWords(unplayable)}`,
      )}
      // A card a person cannot press is not a target for the focus engine.
      data-focusable={unavailable ? undefined : true}
      data-unplayable={unplayable ?? undefined}
    >
      <CardFrame kind="wide" shown={focus.shown && !unavailable}>
        {art ? (
          <>
            <img
              className="mq-card-art"
              src={art}
              alt=""
              loading="lazy"
              draggable={false}
              onError={() => failArt(art)}
            />
            <span className="mq-wide-card-scrim" aria-hidden="true" />
            {art === backdrop ? (
              wordmark ? (
                <img
                  className="mq-wide-card-logo"
                  src={wordmark}
                  alt=""
                  loading="lazy"
                  draggable={false}
                  onError={() => failLogo(wordmark)}
                />
              ) : (
                <span className="mq-wide-card-name">{name}</span>
              )
            ) : null}
          </>
        ) : (
          <span className="mq-card-plate">{name}</span>
        )}
        {badge === "up-next" ? (
          <Badge tone="accent" className="mq-wide-card-badge">
            UP NEXT
          </Badge>
        ) : null}
        {badge === "unplayable" ? (
          <Badge tone="danger" className="mq-wide-card-badge">
            UNPLAYABLE
          </Badge>
        ) : null}
        <CardProgress name={name} progress={progress} />
      </CardFrame>
    </button>
  );
}
