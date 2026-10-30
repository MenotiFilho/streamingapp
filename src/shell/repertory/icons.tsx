import type { ReactNode } from "react";

/**
 * The repertory's drawn icon set (design record §7).
 *
 * One set for the window and the served Remote: a 24×24 viewBox, `currentColor`,
 * `fill="none"` chrome and a filled mark for transport, round caps and joins.
 * The chrome and destination marks draw at 1.7; a mark standing alone over the
 * picture in the OSD passes 2–2.2. Every mark is bare — no circle, square or
 * container — and no Unicode glyph stands in for one.
 */

export const ICON_NAMES = [
  // The six destinations.
  "home",
  "discover",
  "search",
  "library",
  "addons",
  "settings",
  // The programme's chrome.
  "more",
  "back",
  "close",
  "chevron",
  // Transport.
  "previous-episode",
  "next-episode",
  "rewind-10",
  "forward-10",
  "play",
  "pause",
  "stop",
  // The OSD's menus and the picture.
  "fullscreen",
  "volume",
  "volume-muted",
  "picture",
  "subtitles",
  "audio",
  "speed",
  "chapters",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

const DRAWINGS: Record<IconName, ReactNode> = {
  home: <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />,
  discover: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  library: (
    <>
      <path d="M5 4h4v16H5zM11 4h4v16h-4z" />
      <path d="m17.5 5 3.2-.9 2.2 15.2-3.2.9z" />
    </>
  ),
  addons: (
    <>
      <rect x="4" y="4" width="7" height="7" />
      <rect x="13" y="4" width="7" height="7" />
      <rect x="4" y="13" width="7" height="7" />
      <path d="M16.5 13v7M13 16.5h7" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="2.2" />
      <circle cx="15" cy="17" r="2.2" />
    </>
  ),
  more: (
    <>
      <rect x="4" y="5" width="4" height="4" />
      <rect x="10" y="5" width="4" height="4" />
      <rect x="16" y="5" width="4" height="4" />
      <rect x="4" y="13" width="4" height="4" />
      <rect x="10" y="13" width="4" height="4" />
      <rect x="16" y="13" width="4" height="4" />
    </>
  ),
  back: <path d="M20 12H4m6-6-6 6 6 6" />,
  close: <path d="M18 6 6 18M6 6l12 12" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  "previous-episode": (
    <>
      <path d="M6 5v14" />
      <path d="M18 5v14l-9-7z" />
    </>
  ),
  "next-episode": (
    <>
      <path d="M18 5v14" />
      <path d="M6 5v14l9-7z" />
    </>
  ),
  // A counter-clockwise turn with the step drawn inside it, never the glyph.
  "rewind-10": (
    <>
      <path d="M4 12a8 8 0 1 0 2.34-5.66" />
      <path d="M4 4v4h4" />
      <path d="M10 10.2v3.6" />
      <ellipse cx="14.6" cy="12" rx="1.7" ry="2.4" />
    </>
  ),
  "forward-10": (
    <>
      <path d="M20 12a8 8 0 1 1-2.34-5.66" />
      <path d="M20 4v4h-4" />
      <path d="M9.4 10.2v3.6" />
      <ellipse cx="14" cy="12" rx="1.7" ry="2.4" />
    </>
  ),
  play: <path d="M8 5v14l11-7z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="6" y="5" width="4" height="14" fill="currentColor" stroke="none" />
      <rect x="14" y="5" width="4" height="14" fill="currentColor" stroke="none" />
    </>
  ),
  stop: <rect x="6" y="6" width="12" height="12" fill="currentColor" stroke="none" />,
  fullscreen: <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />,
  volume: (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5M18 7a7 7 0 0 1 0 10" />
    </>
  ),
  "volume-muted": (
    <>
      <path d="M11 5 6 9H3v6h3l5 4V5z" />
      <path d="m16 9.5 5 5M21 9.5l-5 5" />
    </>
  ),
  picture: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="m7 16 3.5-4 3 3.5 2-2.5 3 3" />
      <circle cx="8" cy="9" r="1" />
    </>
  ),
  subtitles: (
    <>
      <rect x="3" y="5" width="18" height="14" />
      <path d="M6 10.5h3M11 10.5h7M6 14h5M13 14h5" />
    </>
  ),
  audio: <path d="M12 3v18M8 7v10M4 10v4M16 7v10M20 10v4" />,
  speed: (
    <>
      <path d="M5 16a7 7 0 1 1 14 0" />
      <path d="m12 16 3.5-4" />
      <path d="M12 5v1.5M5 16h1.5M17.5 16H19" />
    </>
  ),
  chapters: <path d="M4 6h3M4 12h3M4 18h3M10 6h10M10 12h10M10 18h10" />,
};

export type IconProps = {
  name: IconName;
  /** 1.7 for chrome; 2–2.2 where a mark stands alone over the picture. */
  strokeWidth?: number;
  className?: string;
  /**
   * An accessible name. Without one the mark is decorative and hidden from
   * assistive technology, which is the case beside every visible label.
   */
  label?: string;
};

/** One drawn mark from the set. */
export function Icon({ name, strokeWidth = 1.7, className, label }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...(label
        ? { role: "img", "aria-label": label }
        : { "aria-hidden": true, focusable: false })}
    >
      {DRAWINGS[name]}
    </svg>
  );
}
