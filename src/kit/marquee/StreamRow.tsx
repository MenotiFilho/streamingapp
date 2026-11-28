/**
 * One Stream (sheet `C5`, 848×128): the tier box, the name as the Addon gave it,
 * its details, the marks the name declares and a play disc. The Stream playing
 * now takes a lavender outline and the PLAYING badge.
 *
 * The whole row is the control. Names, details and marks are the Addon's own
 * words and are drawn verbatim (`docs/design-system.md` §9).
 */

import type { ReactNode } from "react";

import { Icon, type IconName } from "./icons";
import { PpBadge, u } from "./ppParts";
import { tierTone } from "./streamTier";

export type StreamRowProps = {
  /** The Stream's name. */
  name: string;
  /** The resolution class, `4K` or `1080p`; none draws a film mark. */
  tier?: string | null;
  peers?: string | null;
  size?: string | null;
  source?: string | null;
  /** HDR, audio and codec tags, in the name's order. */
  marks?: ReadonlyArray<string>;
  /** Whether this is the Stream playing now. */
  playing?: boolean;
  focused?: boolean;
  disabled?: boolean;
  onPlay?: () => void;
  /** Anything the client adds after the marks, such as a warning of its own. */
  children?: ReactNode;
};

export function StreamRow({
  name,
  tier,
  peers,
  size,
  source,
  marks = [],
  playing = false,
  focused,
  disabled,
  onPlay,
  children,
}: StreamRowProps) {
  const details: Array<{ icon: IconName; label: string; value: string | null | undefined }> = [
    { icon: "users", label: "Peers", value: peers },
    { icon: "disk", label: "Size", value: size },
    { icon: "globe", label: "Source", value: source },
  ];

  return (
    <button
      type="button"
      className="mq-pp mq-pp-stream"
      data-focusable
      data-focused={focused ? "true" : undefined}
      data-playing={playing ? "true" : undefined}
      aria-current={playing ? "true" : undefined}
      disabled={disabled}
      onClick={onPlay}
    >
      <span className="mq-pp-stream-tier" data-tone={tier ? tierTone(tier) : "hd"}>
        {tier ? tier : <Icon name="film" size={u(32)} />}
      </span>
      <span className="mq-pp-stream-name">{name}</span>
      <span className="mq-pp-stream-details">
        {details.map(({ icon, label, value }) =>
          value ? (
            <span key={label} className="mq-pp-stream-detail">
              <Icon name={icon} label={label} size={u(18)} />
              <span>{value}</span>
            </span>
          ) : null,
        )}
      </span>
      <span className="mq-pp-stream-marks">
        {marks.map((mark, index) => (
          <PpBadge key={`${index}:${mark}`}>{mark}</PpBadge>
        ))}
        {children}
      </span>
      {playing ? (
        <PpBadge tone="accent" className="mq-pp-stream-playing">
          PLAYING
        </PpBadge>
      ) : null}
      <span className="mq-pp-stream-disc" aria-hidden="true">
        <Icon name="play" weight="fill" size={u(24)} />
      </span>
    </button>
  );
}
