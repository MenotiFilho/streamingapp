import { AnimatePresence, motion } from "motion/react";
import { useRef, type PointerEvent as ReactPointerEvent } from "react";

import { fade } from "../motion";
import { PhoneArt, PhoneButton, PhoneTicks } from "./controls";
import { heroSwipe, type HeroStep } from "./heroSwipe";

export type PhoneHeroProps = {
  /** Which featured Title is in view; a new key cross-fades. */
  itemKey: string;
  /** The Title's name, drawn in type where it has no logo. */
  name: string;
  backdrop?: string | null;
  logo?: string | null;
  /** The facts line, already worded: the rating, year, runtime, genres. */
  facts: readonly string[];
  /** The index in view, from 0, among `count`. */
  index: number;
  count: number;
  /** How far the rotation beat has run, from 0 to 1. */
  elapsed?: number;
  onWatch: () => void;
  onDetails: () => void;
  /** A sideways swipe asked for the next or the previous featured Title. */
  onSwipe: (step: HeroStep) => void;
};

/**
 * The phone's hero (sheet `C8`, "Hero · phone"): the featured Titles one at a
 * time, 520px tall. It rotates and swipes; with no focus to follow it has no
 * following mode. The beat is the screen's.
 */
export function PhoneHero({
  itemKey,
  name,
  backdrop,
  logo,
  facts,
  index,
  count,
  elapsed,
  onWatch,
  onDetails,
  onSwipe,
}: PhoneHeroProps) {
  const start = useRef<{ id: number; x: number; y: number } | null>(null);

  const down = (event: ReactPointerEvent<HTMLElement>) => {
    // A press that starts on a button is that button's, never a swipe.
    start.current = (event.target as Element).closest("button")
      ? null
      : { id: event.pointerId, x: event.clientX, y: event.clientY };
  };
  const up = (event: ReactPointerEvent<HTMLElement>) => {
    const from = start.current;
    start.current = null;
    if (!from || from.id !== event.pointerId) {
      return;
    }
    const step = heroSwipe(event.clientX - from.x, event.clientY - from.y);
    if (step) {
      onSwipe(step);
    }
  };

  return (
    <section
      className="mq-ph-hero"
      aria-label="Featured"
      onPointerDown={down}
      onPointerUp={up}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      <AnimatePresence initial={false}>
        <motion.div
          key={itemKey}
          className="mq-ph-hero-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade()}
        >
          <PhoneArt src={backdrop} className="mq-ph-cover" />
        </motion.div>
      </AnimatePresence>
      <span className="mq-ph-hero-scrim-top" aria-hidden="true" />
      <span className="mq-ph-hero-scrim-bottom" aria-hidden="true" />
      <AnimatePresence initial={false}>
        <motion.div
          key={itemKey}
          className="mq-ph-hero-copy"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={fade()}
        >
          <h2 className="mq-ph-hero-heading">
            <PhoneArt
              src={logo}
              className="mq-ph-hero-logo"
              alt={name}
              fallback={<span className="mq-ph-hero-name">{name}</span>}
            />
          </h2>
          <p className="mq-ph-hero-facts">{facts.filter(Boolean).join("  ·  ")}</p>
        </motion.div>
      </AnimatePresence>
      <div className="mq-ph-hero-actions">
        <PhoneButton icon="play" filled onClick={onWatch}>
          Watch now
        </PhoneButton>
        <PhoneButton kind="secondary" icon="info" onClick={onDetails}>
          Details
        </PhoneButton>
      </div>
      <PhoneTicks count={count} active={index} elapsed={elapsed} />
    </section>
  );
}
