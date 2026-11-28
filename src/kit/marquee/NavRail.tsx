import { motion } from "motion/react";

import { DESTINATIONS, type Destination } from "../../core/destinations";
import { BrandMark } from "./BrandMark";
import { useCalmMotion } from "./controlsFocus";
import { cx } from "./cx";
import type { IconName } from "./icons";
import { NavItem } from "./NavItem";
import { railTransition } from "./railMotion";

const DESTINATION_ICONS: Record<Destination, IconName> = {
  home: "house",
  discover: "compass",
  search: "search",
  library: "library",
  addons: "puzzle",
  settings: "settings",
};

export type NavRailProps = {
  /** Labels over a near-opaque panel, with the screen behind dimmed. */
  expanded: boolean;
  active: Destination;
  /** The time at the foot, already formatted by the client. */
  clock: string;
  onSelect?: (destination: Destination) => void;
  /** Draw one destination's focus treatment whatever the input modality says. */
  focused?: Destination;
  className?: string;
};

/**
 * The window's side rail (sheet C2): 120px of icons over a left scrim at rest,
 * 360px of labelled destinations while focus is in it. The caller decides when
 * it is expanded; the rail draws it and moves between the two.
 */
export function NavRail({
  expanded,
  active,
  clock,
  onSelect,
  focused,
  className,
}: NavRailProps) {
  const calm = useCalmMotion();
  const target = expanded ? 1 : 0;

  return (
    <motion.nav
      className={cx("mq-nav-rail", className)}
      aria-label="Destinations"
      data-expanded={expanded ? "true" : "false"}
      initial={false}
      animate={{ "--mq-rail-open": target, "--mq-rail-fade": target }}
      transition={railTransition(calm)}
    >
      <span className="mq-nav-rail-dim" aria-hidden="true" />
      <span className="mq-nav-rail-scrim" aria-hidden="true" />
      <span className="mq-nav-rail-panel" aria-hidden="true" />
      <BrandMark className="mq-nav-rail-mark" />
      <ul className="mq-nav-rail-items">
        {DESTINATIONS.map((destination) => (
          <li key={destination.id}>
            <NavItem
              icon={DESTINATION_ICONS[destination.id]}
              label={destination.label}
              expanded={expanded}
              active={destination.id === active}
              focused={destination.id === focused}
              data-destination={destination.id}
              onClick={() => onSelect?.(destination.id)}
            />
          </li>
        ))}
      </ul>
      <span className="mq-nav-rail-clock">{clock}</span>
    </motion.nav>
  );
}
