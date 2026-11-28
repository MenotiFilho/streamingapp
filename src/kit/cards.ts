/**
 * The decisions the artwork cards are drawn from (sheet C3,
 * `docs/design-system.md` §5, §8, §9): how far a card scales under focus, which
 * art it shows, and what it is called.
 */

import { useCallback, useState } from "react";

import type { UnplayableReason } from "../core/wire";

export type CardKind = "poster" | "wide" | "episode";

/** The recorded focus growth of each card, the fallback for the sheet's tokens. */
export const CARD_FOCUS_SCALE: Record<CardKind, number> = {
  poster: 1.08,
  wide: 1.07,
  episode: 1.06,
};

/**
 * `--mq-scale-<kind>`, read from the token sheet at call time as the motion
 * durations are, so the one allowed tuning (§12) has one place to happen.
 */
function focusScale(kind: CardKind): number {
  const fallback = CARD_FOCUS_SCALE[kind];
  if (typeof document === "undefined" || typeof getComputedStyle !== "function") {
    return fallback;
  }
  const value = Number.parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(`--mq-scale-${kind}`),
  );
  return Number.isFinite(value) && value >= 1 ? value : fallback;
}

/**
 * The scale a card is drawn at. With movement left out a focused card keeps its
 * outline and shadow and does not grow (§6).
 */
export function cardScale(
  kind: CardKind,
  state: { shown: boolean; calm: boolean },
): number {
  return state.shown && !state.calm ? focusScale(kind) : 1;
}

/** The first art in a chain that exists and has not failed to load. */
export function firstArt(
  candidates: ReadonlyArray<string | null | undefined>,
  failed: ReadonlySet<string>,
): string | null {
  for (const candidate of candidates) {
    if (candidate && !failed.has(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Walk an artwork chain: the art to draw now, and the report that it did not
 * load, which moves on to the next one.
 */
export function useArtChain(
  candidates: ReadonlyArray<string | null | undefined>,
): [string | null, (failedArt: string) => void] {
  const [failed, setFailed] = useState<ReadonlySet<string>>(() => new Set());
  const fail = useCallback((art: string) => {
    setFailed((current) => new Set(current).add(art));
  }, []);
  return [firstArt(candidates, failed), fail];
}

/** Why a card cannot be played. `addon_disabled` is ADR-0044 §2's second reason. */
export type CardUnplayableReason = UnplayableReason | "addon_disabled";

const UNPLAYABLE_WORDS: Record<CardUnplayableReason, string> = {
  addon_removed: "Addon removed",
  addon_disabled: "Addon disabled",
};

/** The words a card's accessible name says about an unplayable entry. */
export function unplayableWords(reason: CardUnplayableReason): string {
  return UNPLAYABLE_WORDS[reason];
}

/**
 * The one badge a wide card carries at its top left. An entry that cannot be
 * played says so in place of **Up next**: the mark that matters wins.
 */
export function wideCardBadge(state: {
  upNext: boolean;
  unplayable: CardUnplayableReason | null;
}): "unplayable" | "up-next" | null {
  if (state.unplayable) {
    return "unplayable";
  }
  return state.upNext ? "up-next" : null;
}

/** A card's accessible name: what it is, then the marks it carries. */
export function cardLabel(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(", ");
}
