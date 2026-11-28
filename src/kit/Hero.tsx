import { AnimatePresence, motion, useIsPresent } from "motion/react";
import type { ReactNode } from "react";

import { useArtChain } from "./cards";
import { useCalmMotion } from "./controlsFocus";
import { cx } from "./cx";
import {
  heroArtTransition,
  heroLayerKeys,
  heroShift,
  heroShows,
  type HeroMode,
} from "./heroLayout";
import { HeroTicks, type HeroTicksProps } from "./HeroTicks";
import type { MetaInput } from "./meta";
import { MetaLine } from "./MetaLine";
import { fade } from "./motion";

export type HeroProps = {
  mode: HeroMode;
  /** The identity of the title shown; a change cross-fades. */
  titleKey: string;
  name: string;
  logo?: string | null;
  backdrop?: string | null;
  /** The landscape poster, drawn when no backdrop loads. */
  poster?: string | null;
  meta?: MetaInput;
  synopsis?: string | null;
  /** Watch now and Details; drawn only while rotating. */
  actions?: ReactNode;
  /** Drawn only while rotating. */
  ticks?: HeroTicksProps;
  className?: string;
};

/** One title's backdrop. It only fades: the frame around it does the moving. */
function HeroBackdrop({ backdrop, poster }: Pick<HeroProps, "backdrop" | "poster">) {
  const [art, fail] = useArtChain([backdrop, poster]);

  return (
    <motion.div
      className="mq-hero-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fade()}
    >
      {art ? (
        <img
          className="mq-hero-backdrop"
          src={art}
          alt=""
          draggable={false}
          onError={() => fail(art)}
        />
      ) : null}
    </motion.div>
  );
}

/** Where the backdrops sit. It owns the shift between the two modes. */
function HeroArt({
  mode,
  artKey,
  backdrop,
  poster,
  calm,
}: Pick<HeroProps, "mode" | "backdrop" | "poster"> & {
  artKey: string;
  calm: boolean;
}) {
  const shift = heroShift(mode);

  return (
    <motion.div
      className="mq-hero-art"
      aria-hidden="true"
      // Only a calm switch of mode mounts a new frame, and that one fades in.
      initial={calm ? { opacity: 0, "--mq-hero-shift": shift } : false}
      animate={{ opacity: 1, "--mq-hero-shift": shift }}
      exit={{ opacity: 0 }}
      transition={heroArtTransition(calm)}
    >
      <AnimatePresence initial={false}>
        <HeroBackdrop key={artKey} backdrop={backdrop} poster={poster} />
      </AnimatePresence>
      {/* It rides the backdrop's left edge, so the two never part mid-slide. */}
      <span className="mq-hero-scrim" data-scrim="following-left" />
    </motion.div>
  );
}

function HeroCopy({
  mode,
  name,
  logo,
  meta,
  synopsis,
}: Pick<HeroProps, "mode" | "name" | "logo" | "meta" | "synopsis">) {
  const present = useIsPresent();
  const [wordmark, fail] = useArtChain([logo]);

  return (
    <motion.div
      className="mq-hero-copy"
      data-mode={mode}
      // The title on its way out is a picture of the old one, not a second head.
      aria-hidden={present ? undefined : true}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={fade()}
    >
      <h2 className="mq-hero-title">
        {wordmark ? (
          <img
            className="mq-hero-logo"
            src={wordmark}
            alt={name}
            draggable={false}
            onError={() => fail(wordmark)}
          />
        ) : (
          <span className="mq-hero-name">{name}</span>
        )}
      </h2>
      {meta ? <MetaLine {...meta} className="mq-hero-meta" /> : null}
      {synopsis ? <p className="mq-hero-synopsis">{synopsis}</p> : null}
    </motion.div>
  );
}

/**
 * The Home hero (sheet C4). **Rotating** is a 1920×880 backdrop with the logo,
 * facts, synopsis, actions and ticks. **Following focus** moves the backdrop
 * right and keeps only the title and its facts.
 *
 * The actions stay mounted from one title to the next, so a rotation does not
 * take focus from **Watch now**.
 */
export function Hero({
  mode,
  titleKey,
  name,
  logo,
  backdrop,
  poster,
  meta,
  synopsis,
  actions,
  ticks,
  className,
}: HeroProps) {
  const calm = useCalmMotion();
  const keys = heroLayerKeys(mode, titleKey, calm);
  const shows = heroShows(mode);

  return (
    <section
      className={cx("mq-hero", className)}
      aria-label={name}
      data-mode={mode}
    >
      <AnimatePresence initial={false}>
        <HeroArt
          key={keys.frame}
          artKey={keys.art}
          mode={mode}
          backdrop={backdrop}
          poster={poster}
          calm={calm}
        />
      </AnimatePresence>
      <span className="mq-hero-scrim" data-scrim="rotating-left" aria-hidden="true" />
      <span className="mq-hero-scrim" data-scrim="rotating-bottom" aria-hidden="true" />
      <span className="mq-hero-scrim" data-scrim="following-bottom" aria-hidden="true" />
      <AnimatePresence initial={false}>
        <HeroCopy
          key={keys.copy}
          mode={mode}
          name={name}
          logo={logo}
          meta={meta}
          synopsis={synopsis}
        />
      </AnimatePresence>
      {shows.actions && actions ? <div className="mq-hero-actions">{actions}</div> : null}
      {shows.ticks && ticks ? (
        <div className="mq-hero-ticks-slot">
          <HeroTicks {...ticks} />
        </div>
      ) : null}
    </section>
  );
}
