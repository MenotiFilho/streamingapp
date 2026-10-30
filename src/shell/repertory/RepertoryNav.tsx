import { motion } from "motion/react";
import { useEffect, useState } from "react";

import { DESTINATIONS, type Destination } from "../navigation";
import { useReducedMotion } from "../useReducedMotion";
import { spineDestinations, spineLabelTransition, spineWidthTransition } from "./frame";
import { Icon } from "./icons";
import {
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
  active,
  open,
  reducedMotion,
  onChoose,
}: {
  destination: (typeof DESTINATIONS)[number];
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
 * It is the one permanent frame. The six destinations carry their drawn mark
 * and their name, the active one is brass with a 2px rule, and the date and
 * clock sit at the foot. The whole index is one more card — the grid mark —
 * rather than a text link: it opens the All destinations grid. The width
 * change is Motion's panel spring; the labels keep only a fade under reduced
 * motion, and the list stays centred in both states.
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
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onKeyDown={(event) => {
        // A keyboard walk through the index reveals the labels; a pointer that
        // merely focuses the nav does not.
        if (event.key.startsWith("Arrow")) {
          setOpen(true);
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          setOpen(false);
        }
      }}
    >
      <ul className="rep-spine-index">
        {destinations.map((destination) => (
          <SpineItem
            key={destination.id}
            destination={destination}
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
            aria-label="More destinations"
            onClick={onOpenDestinations}
          >
            <span className="rep-index-icon" aria-hidden="true">
              <Icon name="more" />
            </span>
            <motion.span
              className="rep-index-label"
              initial={{ opacity: 0 }}
              animate={{ opacity: open ? 1 : 0 }}
              transition={spineLabelTransition(reducedMotion)}
              aria-hidden="true"
            >
              More
            </motion.span>
          </button>
        </li>
      </ul>
      <div className="rep-spine-foot">
        <span className="rep-spine-date">{programShortDateText(now)}</span>
        <span className="rep-spine-clock">{programTimeText(now)}</span>
      </div>
    </motion.nav>
  );
}
