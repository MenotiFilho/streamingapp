import { useRef, type RefObject } from "react";

import { answeredTitle } from "../core/answers";
import { missingStreamVideo, opensPicker, type AutoplayView } from "../core/autoplay";
import { seriesAction, seriesRef } from "../core/episodes";
import { useMissingStream } from "../core/react/useMissingStream";
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
  const latest = useRef({ snapshot, popover });
  latest.current = { snapshot, popover };

  const onPlayerLevel = () =>
    root.current !== null &&
    root.current.isConnected &&
    !root.current.closest("[inert]") &&
    latest.current.popover === null;

  useMissingStream(
    view,
    (previous, now) => opensPicker(previous, now) && onPlayerLevel(),
    ({ next }) => {
      const nowPlaying = latest.current.snapshot?.playback.nowPlaying ?? null;
      if (nowPlaying === null) {
        return;
      }

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
              render: () => (
                <StreamsLoader
                  title={title}
                  video={missingStreamVideo(title, next)}
                  // The list is spent once the Host has the Stream; removing it
                  // by id is a no-op if a person backed out first.
                  onOpened={() => remove(id)}
                />
              ),
            },
          });
        },
      );
    },
  );
}
