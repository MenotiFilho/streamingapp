/**
 * The grid's own paging trigger (#264): when the last cards come within reach
 * of the viewport, or focus lands among the last few, ask the row's next page.
 *
 * The geometry and the "is a page due" decision are `core/gridPaging`'s; this
 * hook only feeds them the last card's rectangle, the focused card's place and
 * whether a page is already in flight. It listens in the capture phase because
 * a scroll event does not bubble: the window sees the `.shell-level` scroll and
 * the Remote's page scroll alike.
 */

import { useCallback, useEffect, useRef } from "react";

import {
  cardNearEnd,
  GRID_APPROACH_PX,
  GRID_FOCUS_AHEAD,
  gridPageDue,
  nearingEnd,
  type PageState,
} from "../gridPaging";

export type GridEndOptions = {
  /** How many cards are drawn; zero means there is no end to reach yet. */
  count: number;
  /** The row's next page, or null when it has none (done, or not pageable). */
  page: PageState | null;
  /** Whether that page is already in flight; the trigger waits, the store drops it. */
  reading: boolean;
  /** Ask the next page; the store drops a second ask while one is running. */
  onReach: () => void;
  /** How far past the viewport's bottom still counts as reached. */
  margin?: number;
  /** How many cards from the end a focused card counts as near. */
  ahead?: number;
};

/** A ref for the grid's root; every card carries `data-grid-card`. */
export function useGridEnd({
  count,
  page,
  reading,
  onReach,
  margin = GRID_APPROACH_PX,
  ahead = GRID_FOCUS_AHEAD,
}: GridEndOptions) {
  const root = useRef<HTMLElement | null>(null);
  const latest = useRef({ count, page, reading, onReach, margin, ahead });
  latest.current = { count, page, reading, onReach, margin, ahead };

  const check = useCallback(() => {
    const {
      page: next,
      reading: inFlight,
      onReach: reach,
      margin: gap,
      ahead: focusAhead,
    } = latest.current;
    if (!next) {
      return;
    }
    const node = root.current;
    // A level under the top one is painted but inert; its grid must not read
    // on while a person is reading the Title above it.
    if (!node || !node.isConnected || node.closest("[inert]")) {
      return;
    }
    const cards = Array.from(
      node.querySelectorAll<HTMLElement>("[data-grid-card]"),
    );
    if (cards.length === 0) {
      return;
    }

    const last = cards[cards.length - 1];
    const viewport =
      window.innerHeight || document.documentElement.clientHeight || 0;
    const reached =
      last !== undefined && nearingEnd(last.getBoundingClientRect().bottom, viewport, gap);

    const active = document.activeElement;
    const at = active instanceof HTMLElement ? cards.indexOf(active) : -1;
    const focusedNear = at >= 0 && cardNearEnd(at, cards.length, focusAhead);

    if (gridPageDue(next, { reading: inFlight, near: reached || focusedNear })) {
      reach();
    }
  }, []);

  // The listener set is stable; `reading` is read through the ref so a page
  // starting or landing does not re-trigger the effect by itself.
  useEffect(() => {
    if (!root.current) {
      return;
    }
    const onScroll = () => check();
    const onFocus = () => check();
    const onResize = () => check();
    window.addEventListener("scroll", onScroll, true);
    document.addEventListener("focusin", onFocus, true);
    window.addEventListener("resize", onResize);
    check();
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("focusin", onFocus, true);
      window.removeEventListener("resize", onResize);
    };
  }, [check]);

  const due = page !== null && page.failure === null;
  useEffect(() => {
    check();
  }, [check, count, due]);

  return root;
}
