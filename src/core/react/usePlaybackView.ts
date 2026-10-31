import { useMemo, useSyncExternalStore } from "react";

import { playbackView, type PlaybackView } from "../playbackView";
import type { Session } from "../session";
import type { ResumeEntry } from "../wire";
import { usePlaybackPlayed } from "./usePlaybackPosition";

/** No Watch progress at all, with a stable identity for the memo. */
const NO_PROGRESS: readonly ResumeEntry[] = [];

/**
 * The playback view of the Session the client already holds.
 *
 * The Session is passed in rather than built here: the window's Shell owns the
 * one Session over its link, and a second one built from the same link would
 * never see the Actions the Shell sent, so its `pending` would draw no waits
 * (§A8, #137). The hook subscribes to that same Session and runs the one clock.
 */
export function usePlaybackView(session: Session, active: boolean): PlaybackView | null {
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  const playback = state.snapshot?.playback ?? null;
  const watchProgress = state.snapshot?.watchProgress ?? NO_PROGRESS;
  const played = usePlaybackPlayed(playback, active);

  return useMemo(
    () =>
      playback === null
        ? null
        : playbackView(playback, { played, pending: state.pending, watchProgress }),
    [playback, played, state.pending, watchProgress],
  );
}
