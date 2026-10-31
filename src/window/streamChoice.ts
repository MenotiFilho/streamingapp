/**
 * Choosing a Stream, shared by the two surfaces that draw the list.
 *
 * The decision is the Host's and the behaviour is frozen (#27, #137): a
 * candidate this Host can open is taken back to the Host with its Title card,
 * a candidate it cannot is marked where it stands and asks the Host nothing,
 * and a second press while the first is in flight is dropped. Only the drawing
 * of that decision belongs to a surface, which is why this hook lives beside
 * `StreamsScreen` rather than inside it.
 */

import { useCallback, useState } from "react";

import type { Stream, Title, Video } from "../core/wire";
import { playabilityNote } from "../core/stream";
import { titleStubOf, type OpenablePreview } from "../core/title";
import { useShell } from "./context";
import { usePending } from "./usePending";

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
  const { take } = useShell();
  const [chosen, setChosen] = useState<Stream | null>(null);
  // Choosing a Stream is the second wait a person sees: the row says it is
  // opening, and a second press while the Host answers is dropped (#137).
  const { pending: opening, run: openOnce } = usePending();
  const [openingStream, setOpeningStream] = useState<Stream | null>(null);

  const choose = useCallback(
    async (addon: string, stream: Stream) => {
      if (playabilityNote(stream.playback) !== null) {
        setChosen(stream);
        return;
      }

      setChosen(null);
      await openOnce(async () => {
        setOpeningStream(stream);
        try {
          await take({
            type: "play_stream",
            video: { type: title.type, id: video.id },
            addon,
            stream,
            title: titleStubOf(title, preview),
          });
        } finally {
          setOpeningStream(null);
        }
      });
    },
    [openOnce, preview, take, title, video.id],
  );

  return { chosen, opening, openingStream, choose };
}
