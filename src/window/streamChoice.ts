/**
 * Choosing a Stream, shared by the two surfaces that draw the list.
 *
 * The decision is the Host's and the behaviour is frozen (#27, #137): a
 * candidate this Host can open is taken back to the Host with its Title card,
 * a candidate it cannot is marked where it stands and asks the Host nothing,
 * and every row is locked while one candidate is opening. Two guards enforce
 * that (ADR-0027 §2): this control's ref drops a second press before React
 * paints, and the Session's door joins an identical Action. Only the drawing of
 * that decision belongs to a surface, which is why this hook lives beside
 * `StreamsScreen` rather than inside it.
 */

import { useCallback, useRef, useState } from "react";

import { actionKey } from "../core/actionKey";
import type { Action, Stream, Title, Video } from "../core/wire";
import { playabilityNote, playStreamAction } from "../core/stream";
import type { OpenablePreview } from "../core/title";
import { useShell } from "./context";

export type StreamChoice = {
  /** The unplayable candidate that was pressed, drawn as a note. */
  chosen: Stream | null;
  /** Whether any candidate is being asked for right now. */
  opening: boolean;
  /** The candidate whose opening wait is drawn, where there is one. */
  openingStream: Stream | null;
  choose: (addon: string, stream: Stream) => Promise<void>;
};

export function useStreamChoice(
  title: Title,
  preview: OpenablePreview | null | undefined,
  video: Video,
  onOpened?: () => void,
): StreamChoice {
  const { take, pending } = useShell();
  const [chosen, setChosen] = useState<Stream | null>(null);
  // The control's synchronous guard: set before React paints, so two presses in
  // one tick cannot both start. The hook is the door's join, not this layer.
  const openingRef = useRef(false);
  // The candidate whose press is on its way, and the one Action it sent. The
  // wait is derived from the Session's pending key, so a joined press shows the
  // same wait rather than a second one.
  const [opening, setOpening] = useState<{ action: Action; stream: Stream } | null>(null);

  const choose = useCallback(
    async (addon: string, stream: Stream) => {
      if (playabilityNote(stream.playback) !== null) {
        setChosen(stream);
        return;
      }

      // Every row is locked while one candidate is opening: a press that lands
      // before the drawing disables it is dropped here, not sent as a second
      // play_stream. Its different key would not join at the Session's door.
      if (openingRef.current) {
        return;
      }
      openingRef.current = true;

      setChosen(null);
      // One Action, built once by the core: the same one is taken and whose
      // key names the wait this row draws.
      const action: Action = playStreamAction(title, video, addon, stream, preview);
      setOpening({ action, stream });
      try {
        // The Host taking the Stream is what tells a list opened for one press
        // that it is spent. A refusal returns null and leaves the list to say
        // why; the Title's flow passes no callback and keeps the list either way.
        if (await take(action)) {
          onOpened?.();
        }
      } finally {
        openingRef.current = false;
        setOpening(null);
      }
    },
    [onOpened, preview, take, title, video.id],
  );

  const waiting = opening !== null && pending.has(actionKey(opening.action));

  return {
    chosen,
    opening: waiting,
    openingStream: waiting ? opening.stream : null,
    choose,
  };
}
