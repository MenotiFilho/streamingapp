/**
 * A fitted feed's card size, measured (#257).
 *
 * The decision is `pageLayout`'s `fittedCardSize`: the panel's room, less each
 * row's head, its real caption and the track's padding, split across the rows.
 * This hook only feeds it the rectangles the browser knows — the panel's
 * height, a row head's height, the caption block's height — and publishes the
 * width as a CSS custom property the rail reads. jsdom has no layout, so the
 * tests ask the seam, never this hook (ADR-0032).
 *
 * It also measures the page around the panel and publishes the chrome decision
 * (`fittedChrome`): a short page slims the screen's own head, genre row and
 * credit so the posters keep their readable floor.
 */

import { useLayoutEffect, useState, type CSSProperties } from "react";

import {
  FITTED_CARD_FLOOR,
  fittedCardSize,
  fittedChrome,
  type FittedChrome,
} from "../../core/pageLayout";

/** What one row spends around its art: above the art, and the caption below. */
type RowChrome = {
  /** The row's head, its rule and the gap under it. */
  head: number;
  /** The gap above the caption and the caption's real height. */
  caption: number;
  /** The track's top and bottom padding. */
  track: number;
};

/** What one row spends around its art, measured from the row itself. */
function chromeOf(row: HTMLElement): RowChrome {
  const head = row.querySelector<HTMLElement>(".rep-kit-row-head");
  const caption = row.querySelector<HTMLElement>(".rep-kit-poster-caption");
  const track = row.querySelector<HTMLElement>(".rep-kit-row-track");
  const poster = row.querySelector<HTMLElement>(".rep-kit-poster");

  const rowGap = head?.parentElement
    ? Number.parseFloat(getComputedStyle(head.parentElement).rowGap) || 0
    : 0;
  const captionGap = poster
    ? Number.parseFloat(getComputedStyle(poster).rowGap) || 0
    : 0;
  const trackStyle = track ? getComputedStyle(track) : null;

  return {
    head: (head?.offsetHeight ?? 0) + rowGap,
    caption: (caption?.offsetHeight ?? 0) + captionGap,
    track:
      (trackStyle ? Number.parseFloat(trackStyle.paddingTop) || 0 : 0) +
      (trackStyle ? Number.parseFloat(trackStyle.paddingBottom) || 0 : 0),
  };
}

/** The widest chrome either rail spends, so neither rail's caption is clipped. */
function chromeAcross(rows: readonly RowChrome[]): RowChrome {
  return rows.reduce(
    (widest, row) => ({
      head: Math.max(widest.head, row.head),
      caption: Math.max(widest.caption, row.caption),
      track: Math.max(widest.track, row.track),
    }),
    { head: 0, caption: 0, track: 0 },
  );
}

/** The width a fitted feed's cards take, or null before they have been measured. */
export function useFeedCards(rows: number): {
  panel: (element: HTMLDivElement | null) => void;
  style: CSSProperties | undefined;
  chrome: FittedChrome;
} {
  const [panel, setPanel] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);
  const [chrome, setChrome] = useState<FittedChrome>("regular");

  useLayoutEffect(() => {
    if (!panel) {
      return;
    }

    const measure = () => {
      const page = panel.closest<HTMLElement>(".rep-feed");
      setChrome(fittedChrome(page?.clientHeight ?? window.innerHeight));

      if (rows < 1) {
        // A keyless arm or a screen with no rows sizes its cards from the
        // row's width share; a width measured for another arm must not leak.
        setWidth(null);
        return;
      }
      const rowNodes = Array.from(
        panel.querySelectorAll<HTMLElement>(".rep-feed-row"),
      ).slice(0, rows);
      // Discover's rows are the panel's children; Search wraps them, with its
      // own gap. The distance between the first two rows is the real one.
      const [first, second] = rowNodes;
      const gap =
        first && second
          ? Math.max(
              0,
              second.getBoundingClientRect().top -
                first.getBoundingClientRect().bottom,
            )
          : Number.parseFloat(getComputedStyle(panel).rowGap) || 0;
      // An empty row has no caption to measure; the rows that do answer the
      // card size, and the observer returns when their cards arrive.
      const measured = rowNodes.map(chromeOf).filter((row) => row.caption > 0);
      if (measured.length === 0) {
        return;
      }
      const size = fittedCardSize({
        available: panel.clientHeight,
        rows,
        ...chromeAcross(measured),
        gap,
        floor: FITTED_CARD_FLOOR,
      });
      setWidth((previous) => (previous === size.width ? previous : size.width));
    };

    measure();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(panel);
    const page = panel.closest<HTMLElement>(".rep-feed");
    if (page) {
      resize?.observe(page);
    }
    // The rows arrive after the first paint (a query, a genre), so a structural
    // change is the other moment the chrome they spend becomes measurable.
    const mutation =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(measure);
    mutation?.observe(panel, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [panel, rows]);

  return {
    panel: setPanel,
    style:
      width === null
        ? undefined
        : ({ "--rep-feed-card-width": `${width}px` } as CSSProperties),
    chrome,
  };
}
