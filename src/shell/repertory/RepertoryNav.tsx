import { useEffect, useState } from "react";

import { DestinationIcon } from "../Rail";
import { DESTINATIONS, type Destination } from "../navigation";
import {
  programIndex,
  programShortDate as programShortDateText,
  programTime as programTimeText,
} from "./program";
import type { FrameVariant } from "./settings";

/**
 * How many destinations the spine carries before More takes over. The grid
 * always holds the whole programme, so a long index stays navigable without
 * turning the rail into a scroll.
 */
export const RAIL_LIMIT = 15;

/** The destinations the spine draws; the rest live in All destinations. */
const RAIL_DESTINATIONS = DESTINATIONS.slice(0, RAIL_LIMIT);

/** The clock the frame keeps, refreshed slowly enough not to be a metronome. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** The mark for "All destinations": a grid of rooms, not a seventh destination. */
function MoreIcon() {
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
      <rect x="4" y="5" width="4" height="4" />
      <rect x="10" y="5" width="4" height="4" />
      <rect x="16" y="5" width="4" height="4" />
      <rect x="4" y="13" width="4" height="4" />
      <rect x="10" y="13" width="4" height="4" />
      <rect x="16" y="13" width="4" height="4" />
    </svg>
  );
}

function SpineItem({
  destination,
  index,
  active,
  onChoose,
}: {
  destination: (typeof DESTINATIONS)[number];
  index: number;
  active: Destination;
  onChoose: (destination: Destination) => void;
}) {
  return (
    <li>
      <button
        type="button"
        className="rep-index-item"
        data-focusable
        data-destination={destination.id}
        aria-current={active === destination.id ? "page" : undefined}
        aria-label={destination.label}
        onClick={() => onChoose(destination.id)}
      >
        <span className="rep-index-icon" aria-hidden="true">
          <DestinationIcon destination={destination.id} />
        </span>
        <span className="rep-index-number">{programIndex(index + 1)}</span>
        <span className="rep-index-label">{destination.label}</span>
      </button>
    </li>
  );
}

function Spine({
  active,
  onChoose,
  onOpenDestinations,
}: {
  active: Destination;
  onChoose: (destination: Destination) => void;
  onOpenDestinations: () => void;
}) {
  const now = useNow();
  return (
    <nav
      className="rep-nav rep-nav--spine"
      aria-label="Destinations"
      data-region="rail"
      data-kind="rail"
      data-label="the program index"
    >
      <div className="rep-spine-head">
        <p className="rep-spine-label">The program</p>
        <p className="rep-spine-note">Tonight</p>
      </div>
      <ul className="rep-spine-index">
        {RAIL_DESTINATIONS.map((destination, index) => (
          <SpineItem
            key={destination.id}
            destination={destination}
            index={index}
            active={active}
            onChoose={onChoose}
          />
        ))}
        <li>
          <button
            type="button"
            className="rep-index-item rep-index-more"
            data-focusable
            aria-label="All destinations"
            onClick={onOpenDestinations}
          >
            <span className="rep-index-icon" aria-hidden="true">
              <MoreIcon />
            </span>
            <span className="rep-index-number">{programIndex(RAIL_DESTINATIONS.length + 1)}</span>
            <span className="rep-index-label">More</span>
          </button>
        </li>
      </ul>
      <div className="rep-spine-foot">
        <span>{programShortDateText(now)}</span>
        <span className="rep-spine-clock">{programTimeText(now)}</span>
      </div>
    </nav>
  );
}

function ProgramStrip({
  active,
  onChoose,
  onOpenDestinations,
}: {
  active: Destination;
  onChoose: (destination: Destination) => void;
  onOpenDestinations: () => void;
}) {
  return (
    <nav
      className="rep-nav rep-nav--strip"
      aria-label="Destinations"
      data-region="rail"
      data-kind="rail"
      data-label="the program strip"
    >
      <div className="rep-strip-head">
        <p className="rep-strip-label">The program</p>
      </div>
      <ul className="rep-strip-index">
        {RAIL_DESTINATIONS.map((destination, index) => (
          <li key={destination.id}>
            <button
              type="button"
              className="rep-strip-item"
              data-focusable
              data-destination={destination.id}
              aria-current={active === destination.id ? "page" : undefined}
              aria-label={destination.label}
              onClick={() => onChoose(destination.id)}
            >
              <span className="rep-strip-number">{programIndex(index + 1)}</span>
              <span>{destination.label}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="rep-strip-item rep-strip-more"
            data-focusable
            aria-label="All destinations"
            onClick={onOpenDestinations}
          >
            <span className="rep-strip-number">{programIndex(RAIL_DESTINATIONS.length + 1)}</span>
            <span>More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
}

/** The six destinations, drawn as a programme index in either frame. */
export function RepertoryNav({
  variant,
  active,
  onChoose,
  onOpenDestinations,
}: {
  variant: FrameVariant;
  active: Destination;
  onChoose: (destination: Destination) => void;
  onOpenDestinations: () => void;
}) {
  return variant === "spine" ? (
    <Spine active={active} onChoose={onChoose} onOpenDestinations={onOpenDestinations} />
  ) : (
    <ProgramStrip active={active} onChoose={onChoose} onOpenDestinations={onOpenDestinations} />
  );
}
