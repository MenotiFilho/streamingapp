import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { DESTINATIONS, type Destination } from "../navigation";
import { useReducedMotion } from "../useReducedMotion";
import {
  ALL_DESTINATIONS,
  spineDestinations,
  spineLabelTransition,
  spineWidthTransition,
} from "./frame";
import { Icon } from "./icons";
import {
  programIndex,
  programShortDate as programShortDateText,
  programTime as programTimeText,
} from "./program";

/** The clock the frame keeps, refreshed slowly enough not to be a metronome. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

function SpineItem({
  destination,
  index,
  active,
  open,
  reducedMotion,
  onChoose,
}: {
  destination: (typeof DESTINATIONS)[number];
  index: number;
  active: Destination;
  open: boolean;
  reducedMotion: boolean;
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
          <Icon name={destination.id} />
        </span>
        <motion.span
          className="rep-index-number"
          initial={{ opacity: 0 }}
          animate={{ opacity: open ? 1 : 0 }}
          transition={spineLabelTransition(reducedMotion)}
          aria-hidden="true"
        >
          {programIndex(index + 1)}
        </motion.span>
        <motion.span
          className="rep-index-label"
          initial={{ opacity: 0 }}
          animate={{ opacity: open ? 1 : 0 }}
          transition={spineLabelTransition(reducedMotion)}
          aria-hidden="true"
        >
          {destination.label}
        </motion.span>
      </button>
    </li>
  );
}

/**
 * The spine: the programme index, compact at rest and open on focus.
 *
 * It is the one permanent frame. The six destinations are numbered in mono and
 * named in sans, the active one is brass with a 2px rule, and the date and clock
 * sit at the foot. Under fifteen destinations the spine lists them and ends
 * with **All destinations**, whose grid holds the whole programme. The width
 * change is Motion's panel spring, so the spine can be interrupted without
 * overshoot; the page makes room through CSS.
 */
export function RepertoryNav({
  active,
  onChoose,
  onOpenDestinations,
}: {
  active: Destination;
  onChoose: (destination: Destination) => void;
  onOpenDestinations: () => void;
}) {
  const now = useNow();
  const reducedMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const destinations = spineDestinations(DESTINATIONS);

  return (
    <motion.nav
      layout
      transition={spineWidthTransition(reducedMotion)}
      className="rep-nav rep-nav--spine"
      aria-label="Destinations"
      data-region="rail"
      data-kind="rail"
      data-label="the programme index"
      data-open={open ? "true" : undefined}
      onFocus={() => setOpen(true)}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <div className="rep-spine-head">
        <p className="rep-spine-label">The programme</p>
        <p className="rep-spine-note">Tonight</p>
      </div>
      <ul className="rep-spine-index">
        {destinations.map((destination, index) => (
          <SpineItem
            key={destination.id}
            destination={destination}
            index={index}
            active={active}
            open={open}
            reducedMotion={reducedMotion}
            onChoose={onChoose}
          />
        ))}
        <li>
          <button
            type="button"
            className="rep-index-item rep-index-more"
            data-focusable
            aria-label={ALL_DESTINATIONS}
            onClick={onOpenDestinations}
          >
            <span className="rep-index-icon" aria-hidden="true">
              <Icon name="more" />
            </span>
            <motion.span
              className="rep-index-number"
              initial={{ opacity: 0 }}
              animate={{ opacity: open ? 1 : 0 }}
              transition={spineLabelTransition(reducedMotion)}
              aria-hidden="true"
            >
              {programIndex(destinations.length + 1)}
            </motion.span>
            <motion.span
              className="rep-index-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: open ? 1 : 0 }}
              transition={spineLabelTransition(reducedMotion)}
              aria-hidden="true"
            >
              {ALL_DESTINATIONS}
            </motion.span>
          </button>
        </li>
      </ul>
      <div className="rep-spine-foot">
        <span>{programShortDateText(now)}</span>
        <span className="rep-spine-clock">{programTimeText(now)}</span>
      </div>
    </motion.nav>
  );
}
