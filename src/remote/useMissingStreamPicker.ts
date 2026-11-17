import { useRef } from "react";

import { answeredTitle } from "../core/answers";
import { autoplayView, missingStreamVideo } from "../core/autoplay";
import { seriesAction, seriesRef } from "../core/episodes";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import { useMissingStream } from "../core/react/useMissingStream";
import type { Title } from "../core/wire";
import type { RemotePayload } from "./levels";
import { pushesPicker } from "./playerScreen";
import { streamsLevelFor } from "./titleScreen";

/**
 * Where Autoplay found no Stream by continuity, the Remote pushes the Streams
 * picker Level for the episode it was about to play — once per target, and only
 * while it is on its expanded player card (#320, #302). A Remote on a browse or
 * Settings screen is not torn off it; the strip is where it hears of the end.
 *
 * It lives in the room, which is always mounted: the card is a level that may be
 * drawn again after Back leaves the picker, and what this client last drew
 * must survive that, or Back would open the picker again.
 *
 * The Title is the card's own where it lists the episode; otherwise the series
 * is asked for as the Episodes plate would, through the core's `seriesAction`.
 */
export function useMissingStreamPicker({
  session,
  state,
  levelKind,
  cardTitle,
  push,
}: {
  session: Session;
  state: SessionState;
  /** The kind of the level on show, `null` for a destination. */
  levelKind: string | null;
  /** The Title the expanded card holds, where it holds one. */
  cardTitle: Title | null;
  push: (level: NewLevel<RemotePayload>) => string;
}): void {
  const view = autoplayView({ autoplay: state.snapshot?.playback?.autoplay ?? null }, 0);
  const latest = useRef({ state, levelKind, cardTitle, push });
  latest.current = { state, levelKind, cardTitle, push };

  useMissingStream(
    view,
    (previous, now) => pushesPicker(previous, now, latest.current.levelKind),
    ({ next }) => {
      const held = latest.current.cardTitle;
      const listed = held?.videos.find((video) => video.id === next.video.id) ?? null;
      if (held && listed) {
        latest.current.push(streamsLevelFor(held, listed));
        return;
      }

      const nowPlaying = latest.current.state.snapshot?.playback?.nowPlaying ?? null;
      if (nowPlaying === null) {
        return;
      }
      void session
        .ask(seriesAction(seriesRef(latest.current.state.snapshot, nowPlaying)))
        .then(({ response, error }) => {
          const title = error ? null : answeredTitle(response);
          // The answer may land after the person left the card: they are not interrupted.
          if (title === null || latest.current.levelKind !== "player") {
            return;
          }
          latest.current.push(streamsLevelFor(title, missingStreamVideo(title, next)));
        });
    },
  );
}

/** The Title a drawn level holds, for the one kind that carries one on the card. */
export function cardTitleOf(level: { payload: RemotePayload } | null): Title | null {
  return level?.payload.kind === "player" ? level.payload.title : null;
}
