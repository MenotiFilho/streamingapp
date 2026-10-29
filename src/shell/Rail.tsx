import type { ReactNode } from "react";

import { cx } from "./kit/cx";
import { DESTINATIONS, type Destination } from "./navigation";

/**
 * One destination's icon. The rail is the only permanent furniture, so each
 * destination needs a mark that reads across the room even before its label.
 * The icons are drawn in the page's own ink and inherit the focus colour.
 */
const ICONS: Record<Destination, ReactNode> = {
  home: (
    <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" />
  ),
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
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
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
};

/** One destination's mark, shared by the Velvet rail and the repertory spine. */
export function DestinationIcon({ destination }: { destination: Destination }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICONS[destination]}
    </svg>
  );
}

export type RailProps = {
  active: Destination;
  onChoose: (destination: Destination) => void;
};

/**
 * The persistent six-destination rail: **Home · Discover · Search · Library ·
 * Addons · Settings**, in that order, on a floating glass column. Choosing a
 * destination replaces the base screen; the rail itself never moves.
 */
export function Rail({ active, onChoose }: RailProps) {
  return (
    <nav
      className="shell-rail"
      aria-label="Destinations"
      data-region="rail"
      data-kind="rail"
      data-label="the rail"
    >
      {DESTINATIONS.map((destination) => (
        <button
          key={destination.id}
          type="button"
          className={cx("shell-rail-item", "kit-focus-invert")}
          data-focusable
          data-destination={destination.id}
          aria-label={destination.label}
          aria-current={active === destination.id ? "page" : undefined}
          onClick={() => onChoose(destination.id)}
        >
          <span className="shell-rail-icon" aria-hidden="true">
            <DestinationIcon destination={destination.id} />
          </span>
          <span className="shell-rail-label">{destination.label}</span>
        </button>
      ))}
    </nav>
  );
}
