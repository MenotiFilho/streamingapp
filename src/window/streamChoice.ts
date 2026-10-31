/**
 * Choosing a Stream, shared by the two surfaces that draw the list.
 *
 * The decision is the Host's and the behaviour is frozen (#27, #137): a
 * candidate this Host can open is taken back to the Host with its Title card,
 * a candidate it cannot is marked where it stands and asks the Host nothing,
 * and a second press of the same candidate joins the Action already in flight
 * rather than sending it twice. Only the drawing of that decision belongs to a
 * surface, which is why this hook lives beside `StreamsScreen` rather than
 * inside it.
 */

import { useCallback, useState } from "react";

import { actionKey } from "../core/actionKey";
import type { Action, Stream, Title, Video } from "../core/wire";
import { playabilityNote } from "../core/stream";
import { titleStubOf, type OpenablePreview } from "../core/title";
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
): StreamChoice {
  const { take, pending } = useShell();
  const [chosen, setChosen] = useState<Stream | null>(null);
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

      setChosen(null);
      // One Action, built once: the same one is taken and whose key names the
      // wait this row draws.
      const action: Action = {
        type: "play_stream",
        video: { type: title.type, id: video.id },
        addon,
        stream,
        title: titleStubOf(title, preview),
      };
      setOpening({ action, stream });
      try {
        await take(action);
      } finally {
        setOpening(null);
      }
    },
    [preview, take, title, video.id],
  );

  const waiting = opening !== null && pending.has(actionKey(opening.action));

  return {
    chosen,
    opening: waiting,
    openingStream: waiting ? opening.stream : null,
    choose,
  };
}
