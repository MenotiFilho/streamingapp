import { useCallback, useRef } from "react";

import { answeredTitle, type Action, type Title } from "../host-client";
import { discoveredKeyOf, type OpenablePreview } from "../title";
import { useShell, type NewShellLevel } from "./context";
import { RepertoryTitleLoading, RepertoryTitleScreen } from "./repertory/RepertoryTitle";

/**
 * The two doors a card has into the Title screen: its Addon's `open_title`, or
 * TMDB's `open_discovered_title` when the card was a Discovered Title.
 *
 * The Action is taken before the level is pushed, so a refusal leaves the card
 * where it was and the shell's one alert explains it. The answer is the client's
 * own (ADR-0005): the level is the screen that draws it, and nothing about it
 * travels back to the Host until a Video's Streams are asked for.
 */
export function useTitleOpener() {
  const { take, push, remove, levelExists } = useShell();
  // A second Activate before the first answer arrives would push a second
  // identical Title; one open is in flight at a time, whichever screen asked.
  const opening = useRef(false);

  /**
   * Open a Title at once: the card's own art and name are drawn as the level
   * while the Host asks for the full record, and the same level is replaced by
   * the real Title when the answer arrives. A Back while it loads takes the
   * level away, and an answer that comes later does not bring it back.
   */
  const openWith = useCallback(
    async (action: Action, preview: OpenablePreview) => {
      if (opening.current) {
        return;
      }
      opening.current = true;
      let cancelled = false;
      const id = push({
        name: "Title",
        kind: "overlay",
        render: () => <RepertoryTitleLoading preview={preview} />,
        onBack: () => {
          // Backing out of the waiting Title lets the next card be pressed
          // without waiting for the first answer; the late answer is dropped.
          cancelled = true;
          opening.current = false;
          return false;
        },
      });
      try {
        const response = await take(action);
        if (cancelled || !levelExists(id)) {
          return;
        }
        const title = answeredTitle(response);
        if (title) {
          push({ ...titleLevelOf(title, preview), id });
        } else {
          remove(id);
        }
      } finally {
        opening.current = false;
      }
    },
    [levelExists, push, remove, take],
  );

  const openTitle = useCallback(
    (addon: string, preview: OpenablePreview) =>
      openWith(
        {
          type: "open_title",
          addon,
          title: { type: preview.type, id: preview.id },
        },
        preview,
      ),
    [openWith],
  );

  const openDiscoveredTitle = useCallback(
    async (preview: OpenablePreview) => {
      const key = discoveredKeyOf(preview.id);
      if (!key) {
        return;
      }
      await openWith(
        { type: "open_discovered_title", key, kind: preview.type },
        preview,
      );
    },
    [openWith],
  );

  return { openTitle, openDiscoveredTitle };
}

/** The pushed level a Title is drawn on. */
export function titleLevelOf(
  title: Title,
  preview?: OpenablePreview | null,
): NewShellLevel {
  return {
    name: "Title",
    kind: "overlay",
    render: () => <RepertoryTitleScreen title={title} preview={preview} />,
  };
}

export { RepertoryTitleScreen as TitleScreen };
