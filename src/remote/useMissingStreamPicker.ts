import { useEffect, useRef } from "react";

import { answeredTitle } from "../core/answers";
import { autoplayView, type AutoplayView } from "../core/autoplay";
import { seriesAction, seriesRef } from "../core/episodes";
import type { NewLevel } from "../core/navigation";
import type { Session, SessionState } from "../core/session";
import type { Title, Video } from "../core/wire";
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
  const previous = useRef<AutoplayView>({ kind: "none" });
  const latest = useRef({ state, levelKind, cardTitle, push });
  latest.current = { state, levelKind, cardTitle, push };

  const target = view.kind === "no_stream" ? `${view.next.video.type}|${view.next.video.id}` : null;

  useEffect(() => {
    const opens = pushesPicker(previous.current, view, latest.current.levelKind);
    previous.current = view;
    if (!opens || view.kind !== "no_stream") {
      return;
    }

    const { next } = view;
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
        latest.current.push(streamsLevelFor(title, videoOf(title, next)));
      });
    // Only a new target is a new question; the view's other fields move every tick.
  }, [target]);
}

/** The episode as its Title lists it, or as Autoplay named it where the list does not hold it. */
function videoOf(
  title: Title,
  next: Extract<AutoplayView, { kind: "no_stream" }>["next"],
): Video {
  return (
    title.videos.find((video) => video.id === next.video.id) ?? {
      id: next.video.id,
      name: next.name,
      season: Number(/^.+:(\d+):\d+$/.exec(next.video.id)?.[1] ?? 0),
      episode: Number(/^.+:\d+:(\d+)$/.exec(next.video.id)?.[1] ?? 0),
      thumbnail: next.still,
      airDate: null,
    }
  );
}

/** The Title a drawn level holds, for the one kind that carries one on the card. */
export function cardTitleOf(level: { payload: RemotePayload } | null): Title | null {
  return level?.payload.kind === "player" ? level.payload.title : null;
}
