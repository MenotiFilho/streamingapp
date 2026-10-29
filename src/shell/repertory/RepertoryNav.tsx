import { useEffect, useState } from "react";

import { DESTINATIONS, type Destination } from "../navigation";
import {
  programIndex,
  programShortDate as programShortDateText,
  programTime as programTimeText,
} from "./program";
import type { FrameVariant } from "./settings";

/** The clock the frame keeps, refreshed slowly enough not to be a metronome. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function DestinationItem({
  destination,
  index,
  active,
  onChoose,
  itemClass,
  numberClass,
}: {
  destination: (typeof DESTINATIONS)[number];
  index: number;
  active: Destination;
  onChoose: (destination: Destination) => void;
  itemClass: string;
  numberClass: string;
}) {
  return (
    <li>
      <button
        type="button"
        className={itemClass}
        data-focusable
        data-destination={destination.id}
        aria-current={active === destination.id ? "page" : undefined}
        onClick={() => onChoose(destination.id)}
      >
        <span className={numberClass}>{programIndex(index + 1)}</span>
        <span>{destination.label}</span>
      </button>
    </li>
  );
}

function Spine({
  active,
  onChoose,
}: {
  active: Destination;
  onChoose: (destination: Destination) => void;
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
        {DESTINATIONS.map((destination, index) => (
          <DestinationItem
            key={destination.id}
            destination={destination}
            index={index}
            active={active}
            onChoose={onChoose}
            itemClass="rep-index-item"
            numberClass="rep-index-number"
          />
        ))}
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
}: {
  active: Destination;
  onChoose: (destination: Destination) => void;
}) {
  const now = useNow();
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
        <p className="rep-strip-date">
          <span>{programShortDateText(now)}</span>
          <span>{programTimeText(now)}</span>
        </p>
      </div>
      <ul className="rep-strip-index">
        {DESTINATIONS.map((destination, index) => (
          <DestinationItem
            key={destination.id}
            destination={destination}
            index={index}
            active={active}
            onChoose={onChoose}
            itemClass="rep-strip-item"
            numberClass="rep-strip-number"
          />
        ))}
      </ul>
    </nav>
  );
}

/** The six destinations, drawn as a programme index in either frame. */
export function RepertoryNav({
  variant,
  active,
  onChoose,
}: {
  variant: FrameVariant;
  active: Destination;
  onChoose: (destination: Destination) => void;
}) {
  return variant === "spine" ? (
    <Spine active={active} onChoose={onChoose} />
  ) : (
    <ProgramStrip active={active} onChoose={onChoose} />
  );
}
