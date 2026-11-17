import { useEffect, useRef, type RefObject } from "react";

import { answeredTitle } from "../core/answers";
import { opensPicker, type AutoplayView } from "../core/autoplay";
import { seriesAction, seriesRef } from "../core/episodes";
import type { Title, Video } from "../core/wire";
import { useShell } from "./context";
import { StreamsLoader } from "./StreamsScreen";

/**
 * Where Autoplay found no Stream by continuity, the Streams picker for the
 * episode it was about to play is pushed once (#302, ticket #320).
 *
 * "Once" is the core's `opensPicker` over what this player drew last and what
 * it draws now. Only the window's player level acts: while a popover or another
 * level is above it the player is not the surface a person is on, and the
 * picker does not interrupt them. The Title is asked for as an Episodes press
 * asks for it — the series question the core builds from what is playing — and
 * the picker is the same Streams level a chosen Video pushes.
 */
export function useMissingStreamPicker(
  root: RefObject<HTMLElement | null>,
  view: AutoplayView,
): void {
  const { snapshot, ask, push, remove, popover } = useShell();
  const previous = useRef<AutoplayView>({ kind: "none" });
  const latest = useRef({ snapshot, popover });
  latest.current = { snapshot, popover };

  const target = view.kind === "no_stream" ? `${view.next.video.type}|${view.next.video.id}` : null;

  useEffect(() => {
    const opens = opensPicker(previous.current, view);
    previous.current = view;
    if (!opens || view.kind !== "no_stream") {
      return;
    }

    const onPlayerLevel = () =>
      root.current !== null &&
      root.current.isConnected &&
      !root.current.closest("[inert]") &&
      latest.current.popover === null;
    const nowPlaying = latest.current.snapshot?.playback.nowPlaying ?? null;
    if (!onPlayerLevel() || nowPlaying === null) {
      return;
    }

    const { next } = view;
    void ask(seriesAction(seriesRef(latest.current.snapshot, nowPlaying))).then(
      ({ response, error }) => {
        const title = error ? null : answeredTitle(response);
        // The answer may land after a person moved on: the level above counts.
        if (title === null || !onPlayerLevel()) {
          return;
        }
        const id = push({
          name: "Streams",
          kind: "overlay",
          payload: {
            render: () =>
              (
                <StreamsLoader
                  title={title}
                  video={videoOf(title, next)}
                  // The list is spent once the Host has the Stream; removing it
                  // by id is a no-op if a person backed out first.
                  onOpened={() => remove(id)}
                />
              ),
          },
        });
      },
    );
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
