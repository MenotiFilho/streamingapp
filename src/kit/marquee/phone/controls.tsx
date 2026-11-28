import { useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { cx } from "../cx";
import { Icon, type IconName } from "../icons";
import { clampRatio } from "./seekMath";

/*
 * The C1 controls at hand scale that sheet `C8` composes: the Icon button, the
 * Button (M), the Badge, the Switch, the hero ticks, and the two marks every
 * card shares (art with a fallback, a progress line). A finger gets a pressed
 * state, never focus; a keyboard keeps the window's focus rules
 * (`docs/design-system.md` §5).
 */

export type PhoneIconButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "children" | "type" | "aria-label"
> & {
  /** The accessible name: the mark has no visible words. */
  label: string;
  icon: IconName;
  /** Fill weight, for transport and active marks. */
  filled?: boolean;
  /** 48px (M), 56px (L) or 80px (XL). */
  size?: "m" | "l" | "xl";
  kind?: "primary" | "secondary" | "ghost";
};

const ICON_SIZES = { m: 22, l: 26, xl: 34 } as const;

/** A round control with one glyph in it. */
export function PhoneIconButton({
  label,
  icon,
  filled = false,
  size = "m",
  kind = "ghost",
  className,
  ...button
}: PhoneIconButtonProps) {
  return (
    <button
      {...button}
      type="button"
      aria-label={label}
      className={cx("mq-ph mq-ph-icon-button mq-focus-control", className)}
      data-focusable
      data-size={size}
      data-kind={kind}
    >
      <Icon name={icon} weight={filled ? "fill" : "regular"} size={ICON_SIZES[size]} />
    </button>
  );
}

export type PhoneButtonProps = Omit<ComponentPropsWithoutRef<"button">, "children"> & {
  kind?: "primary" | "secondary" | "ghost" | "danger";
  /** The leading glyph, where the button has one. */
  icon?: IconName;
  filled?: boolean;
  children: ReactNode;
};

/** The 48px pill. */
export function PhoneButton({
  kind = "primary",
  icon,
  filled = false,
  className,
  children,
  type = "button",
  ...button
}: PhoneButtonProps) {
  return (
    <button
      {...button}
      type={type}
      className={cx("mq-ph mq-ph-button mq-focus-control", className)}
      data-focusable
      data-kind={kind}
    >
      {icon ? <Icon name={icon} weight={filled ? "fill" : "regular"} size={18} /> : null}
      <span>{children}</span>
    </button>
  );
}

/** A 28px mark: a Stream's own words, or UP NEXT / PLAYING in lavender. */
export function PhoneBadge({
  tone = "neutral",
  className,
  children,
  ...span
}: ComponentPropsWithoutRef<"span"> & {
  tone?: "neutral" | "accent" | "danger";
  children: ReactNode;
}) {
  return (
    <span {...span} className={cx("mq-ph-badge", className)} data-tone={tone}>
      {children}
    </span>
  );
}

/** The 60×34 switch drawing. The control that wraps it carries the state. */
export function PhoneSwitchMark({ on }: { on: boolean }) {
  return (
    <span className="mq-ph-switch" data-on={on} aria-hidden="true">
      <span className="mq-ph-switch-knob" />
    </span>
  );
}

/** A lavender or white fill along a track: playback progress on a card or the strip. */
export function PhoneProgress({ ratio, className }: { ratio: number; className?: string }) {
  const held = clampRatio(ratio);
  return (
    <span className={cx("mq-ph-progress", className)} aria-hidden="true">
      {held > 0 ? (
        <span className="mq-ph-progress-fill" style={{ width: `${held * 100}%` }} />
      ) : null}
    </span>
  );
}

/**
 * Which of the featured Titles the hero shows. The bar of the one in view fills
 * until it rotates. It marks and is not pressed: on a phone the hero is swiped.
 */
export function PhoneTicks({
  count,
  active,
  elapsed = 0,
}: {
  count: number;
  /** The index in view, from 0. */
  active: number;
  /** How far the beat has run, from 0 to 1. */
  elapsed?: number;
}) {
  if (count < 2) {
    return null;
  }

  return (
    <span className="mq-ph-ticks" aria-hidden="true">
      {Array.from({ length: Math.max(0, count) }, (_, index) => (
        <span key={index} className="mq-ph-tick" data-active={index === active}>
          {index === active ? (
            <span
              className="mq-ph-tick-elapsed"
              style={{ width: `${clampRatio(elapsed) * 100}%` }}
            />
          ) : null}
        </span>
      ))}
    </span>
  );
}

/** Artwork that falls back, as `docs/design-system.md` §9 says, when there is none. */
export function PhoneArt({
  src,
  className,
  alt = "",
  fallback = null,
}: {
  src: string | null | undefined;
  className?: string;
  /** Empty where the control around the art already names it. */
  alt?: string;
  fallback?: ReactNode;
}) {
  const [failed, setFailed] = useState<string | null>(null);

  if (!src || failed === src) {
    return <>{fallback}</>;
  }

  return (
    <img
      className={className}
      src={src}
      alt={alt}
      draggable={false}
      onError={() => setFailed(src)}
    />
  );
}
