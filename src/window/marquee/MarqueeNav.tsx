import { useEffect, useRef, useState } from "react";

import { formatNavClock, railShouldExpand } from "../../core/homeHero";
import { useInputModality } from "../../core/react/useInputModality";
import { NavRail } from "../../kit/NavRail";
import type { Destination } from "../navigation";

/** Refresh the rail's foot clock without acting as a high-frequency timer. */
function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export type MarqueeNavProps = {
  active: Destination;
  onChoose: (destination: Destination) => void;
};

/**
 * The Marquee navigation rail wrapper: owns the `rail` spatial-focus region,
 * tracks hover and ADR-0037 navigation-focus expansion, and passes the current
 * clock into the `NavRail` kit primitive.
 */
export function MarqueeNav({ active, onChoose }: MarqueeNavProps) {
  const now = useNow();
  const modality = useInputModality();
  const region = useRef<HTMLDivElement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focusedInRail, setFocusedInRail] = useState(false);

  // Catch modality switching to navigation while a rail item already holds focus.
  useEffect(() => {
    const activeElement = document.activeElement;
    const inside = activeElement instanceof Node && Boolean(region.current?.contains(activeElement));
    setFocusedInRail(inside);
  }, [modality]);

  const expanded = railShouldExpand({ hovered, focusedInRail, modality });

  return (
    <div
      ref={region}
      className="mq-nav-region"
      data-region="rail"
      data-kind="rail"
      data-label="Destinations"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => {
        setFocusedInRail(true);
      }}
      onKeyDown={(event) => {
        if (event.key.startsWith("Arrow")) {
          setFocusedInRail(true);
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget as Node | null;
        if (!next || !event.currentTarget.contains(next)) {
          setFocusedInRail(false);
        }
      }}
    >
      <NavRail
        expanded={expanded}
        active={active}
        clock={formatNavClock(now)}
        onSelect={onChoose}
      />
    </div>
  );
}
