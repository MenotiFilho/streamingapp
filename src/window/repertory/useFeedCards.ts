/**
 * A fitted feed's card size, measured (#257).
 *
 * The decision is `pageLayout`'s `fittedCardSize`: the panel's room, less each
 * row's head and caption, split across the rows. This hook only feeds it the
 * rectangles the browser knows — the panel's height, a row head's height, the
 * caption's line height — and publishes the width as a CSS custom property the
 * rail reads. jsdom has no layout, so the tests ask the seam, never this hook
 * (ADR-0032).
 */

import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from "react";

import { FITTED_CARD_FLOOR, fittedCardSize } from "../../core/pageLayout";

/**
 * What a poster row spends around its art, in px: the track's 6px top and 10px
 * bottom padding and the 12px gap between the art and its caption. Only the
 * head and the caption are measured, because only they follow the type scale.
 */
const TRACK_CHROME = 28;

/** How many caption lines a fitted card reserves: one, so both rails keep room. */
const CAPTION_LINES = 1;

/** The width a fitted feed's cards take, or null before they have been measured. */
export function useFeedCards(rows: number): {
  panel: RefObject<HTMLDivElement | null>;
  style: CSSProperties | undefined;
} {
  const panel = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState<number | null>(null);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node || rows < 1) {
      return;
    }

    const measure = () => {
      const gap = Number.parseFloat(getComputedStyle(node).rowGap) || 0;
      const rowNodes = Array.from(
        node.querySelectorAll<HTMLElement>(".rep-feed-row"),
      ).slice(0, rows);
      let chrome = 0;
      for (const row of rowNodes) {
        const head = row.querySelector<HTMLElement>(".rep-kit-row-head");
        const name = row.querySelector<HTMLElement>(".rep-kit-poster-name");
        const style = name ? getComputedStyle(name) : null;
        const fontSize = style ? Number.parseFloat(style.fontSize) || 0 : 0;
        const lineHeight =
          style ? Number.parseFloat(style.lineHeight) || fontSize * 1.22 : 0;
        chrome += (head?.offsetHeight ?? 0) + lineHeight * CAPTION_LINES + TRACK_CHROME;
      }
      const size = fittedCardSize({
        available: node.clientHeight,
        rows,
        chrome: rowNodes.length === 0 ? 0 : chrome / rowNodes.length,
        gap,
        floor: FITTED_CARD_FLOOR,
      });
      setWidth((previous) => (previous === size.width ? previous : size.width));
    };

    measure();
    const resize =
      typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    resize?.observe(node);
    // The rows arrive after the first paint (a query, a genre), so a structural
    // change is the other moment the chrome they spend becomes measurable.
    const mutation =
      typeof MutationObserver === "undefined"
        ? null
        : new MutationObserver(measure);
    mutation?.observe(node, { childList: true, subtree: true });
    window.addEventListener("resize", measure);
    return () => {
      resize?.disconnect();
      mutation?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [rows]);

  return {
    panel,
    style:
      width === null
        ? undefined
        : ({ "--rep-feed-card-width": `${width}px` } as CSSProperties),
  };
}
