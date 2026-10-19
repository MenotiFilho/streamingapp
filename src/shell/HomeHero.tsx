import { useEffect, useRef, useState } from "react";

import type { HeroSlide } from "./home";

export type HomeHeroProps = {
  slides: readonly HeroSlide[];
  /** The Featured catalog's name, drawn as the slide's kicker. */
  catalogName: string | null;
  onOpen: (slide: HeroSlide) => void;
};

/** How long a slide holds before the billboard moves while nobody is on it. */
export const HERO_ROTATION_MS = 6000;

/**
 * The Featured catalog's billboard: one focusable surface whose slide steps on
 * Left/Right and rotates every six seconds while it is not focused.
 *
 * It is one control rather than four cards, so Left on slide 1 falls through to
 * the shell's focus engine and crosses to the rail, as the spatial model says
 * it should (#51). The button owns the slides; the dots are a readout, not
 * controls, so arrow keys are the one way to step.
 */
export function HomeHero({ slides, catalogName, onOpen }: HomeHeroProps) {
  const [index, setIndex] = useState(0);
  const [held, setHeld] = useState(false);
  const button = useRef<HTMLButtonElement | null>(null);
  const reducedMotion = useReducedMotion();
  const active = Math.min(index, Math.max(0, slides.length - 1));
  const slide = slides[active];

  useEffect(() => {
    if (slides.length === 0) {
      return;
    }
    setIndex((current) => Math.min(current, slides.length - 1));
  }, [slides.length]);

  // The launch focus can be put on the hero while the document itself is in
  // the background; some engines then set activeElement without emitting a
  // focus event. When the window comes forward, believe activeElement.
  useEffect(() => {
    const sync = () => setHeld(document.activeElement === button.current);
    window.addEventListener("focus", sync);
    sync();
    return () => window.removeEventListener("focus", sync);
  }, []);

  // `index` is a dependency so a manual step restarts the six seconds: a press
  // at 5.9s must not be followed by an automatic step 0.1s later.
  useEffect(() => {
    if (slides.length < 2 || held || reducedMotion) {
      return;
    }
    const timer = window.setInterval(() => {
      setIndex((current) => (current + 1) % slides.length);
    }, HERO_ROTATION_MS);
    return () => window.clearInterval(timer);
  }, [held, index, reducedMotion, slides.length]);

  if (!slide) {
    return null;
  }

  const rotating = slides.length > 1 && !reducedMotion;
  const step = (delta: number) => {
    setIndex((current) => Math.max(0, Math.min(slides.length - 1, current + delta)));
  };

  return (
    <section
      className="home-hero"
      data-region="home-hero"
      data-kind="row"
      data-label="Featured"
      aria-roledescription="carousel"
      aria-label="Featured"
    >
      <button
        ref={button}
        type="button"
        className="home-hero-button kit-focus-lift"
        data-focusable
        data-testid="home-hero"
        data-art={slide.artKind}
        aria-label={`Featured Title: ${slide.name}. Open Title.`}
        onFocus={() => setHeld(true)}
        onBlur={() => setHeld(false)}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" && index < slides.length - 1) {
            event.preventDefault();
            event.stopPropagation();
            step(1);
          } else if (event.key === "ArrowLeft" && index > 0) {
            event.preventDefault();
            event.stopPropagation();
            step(-1);
          }
        }}
        onClick={() => onOpen(slide)}
      >
        {slide.art ? (
          <img
            className="home-hero-art"
            src={slide.art}
            alt=""
            data-art-kind={slide.artKind}
          />
        ) : null}
        <span className="home-hero-scrim" aria-hidden="true" />
        <span className="home-hero-copy">
          <span className="home-hero-kicker">{catalogName ?? "Featured"}</span>
          <span className="home-hero-name">{slide.name}</span>
          {slide.description ? (
            <span className="home-hero-description">{slide.description}</span>
          ) : null}
        </span>
      </button>

      <div className="home-hero-footer">
        <div className="home-hero-dots" aria-hidden="true">
          {slides.map((dotSlide, dot) => (
            <span
              key={dotSlide.id}
              className="home-hero-dot"
              data-active={dot === active ? "true" : undefined}
            />
          ))}
        </div>
        <span className="home-hero-status">
          {!rotating ? "Rotation off" : held ? "Focused · rotation held" : "Auto-rotating"}
        </span>
      </div>
    </section>
  );
}

/** Whether the system asks this window to leave motion out (#52). */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window.matchMedia !== "function") {
      return false;
    }
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });

  useEffect(() => {
    if (typeof window.matchMedia !== "function") {
      return;
    }
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  return reduced;
}
