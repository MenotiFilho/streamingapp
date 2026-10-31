/**
 * The still a timeline tooltip asks the Host for, and the one-in-flight rule
 * that keeps a drag from asking a hundred times.
 *
 * A Seek preview is a Question (ADR-0028): the window asks for a moment and the
 * Host answers the still of the five-second bucket that moment falls in, or
 * nothing at all. This holds only what a client may hold — the asks in flight,
 * the answers already seen for the Stream playing, and where the pointer is —
 * and never the Stream itself, which has no name here a client could use.
 *
 * One asked at a time, and the newest wins: moving the pointer across ten
 * buckets sends one ask, then the one the pointer came to rest on. The still
 * already drawn stays until the new bucket's answer arrives, so the tooltip
 * never blinks empty while it is being read.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { answeredPreview } from "../host-client";
import { useShell } from "./context";
import { previewBucket } from "./osd";

/**
 * The still being drawn: the image, and the bucket it is the still of.
 */
export type PreviewStill = { bucket: number; image: string };
/**
 * How many stills a client keeps: the Host keeps two hundred buckets (~2 MB)
 * and a client that kept every bucket a drag crossed would hold a film's worth
 * of them (ADR-0028). The oldest leaves when one more arrives.
 */
export const PREVIEW_STILLS_KEPT = 200;

/** Keep one bucket's answer, dropping the oldest once the client's share is full. */
export function rememberStill(
  cache: Map<number, string | null>,
  bucket: number,
  image: string | null,
): void {
  cache.delete(bucket);
  cache.set(bucket, image);
  while (cache.size > PREVIEW_STILLS_KEPT) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) {
      break;
    }
    cache.delete(oldest);
  }
}

/** What the tooltip reads, and the one call the timeline makes on a pointer. */
export type PreviewReads = {
  /** The last still answered for the Stream, or nothing. */
  still: PreviewStill | null;
  /** Whether the bucket under the pointer has no answer yet. */
  waiting: boolean;
  /**
   * The moment under the pointer, or `null` when it left the bar. Asks the Host
   * where the bucket has no answer yet; a moment already answered is read from
   * the cache and asks nothing.
   */
  point: (at: number | null) => void;
};

/**
 * The still a person pointing at the timeline sees, for the Stream playing now.
 *
 * `stream` is what a client can tell one Stream from another by — `streamKey` in
 * `./osd` — and a new one clears the stills of the Stream before it.
 */
export function usePreview(stream: string | null): PreviewReads {
  const { ask } = useShell();
  const [still, setStill] = useState<PreviewStill | null>(null);
  const [waiting, setWaiting] = useState(false);

  /** The answers already seen, by bucket: an image, or `null` for no still. */
  const cache = useRef(new Map<number, string | null>());
  /** The bucket the pointer is in, so an answer for another one draws nothing. */
  const hovered = useRef<number | null>(null);
  /** The bucket being asked about, while one is in flight. */
  const inFlight = useRef<number | null>(null);
  /** The newest ask the pointer made while one was in flight. */
  const wanted = useRef<{ bucket: number; at: number } | null>(null);
  /**
   * Which Stream the answers belong to, counted: an answer that arrives after
   * another Stream started is not a still of this one, and is dropped rather
   * than kept under a bucket the two Streams happen to share.
   */
  const generation = useRef(0);
  /** The shell's ask, held by ref so a render never restarts a request. */
  const asking = useRef(ask);
  asking.current = ask;

  // A still of one Stream is not a still of another: opening a film or an
  // episode clears what the last one answered.
  useEffect(() => {
    generation.current += 1;
    cache.current.clear();
    hovered.current = null;
    inFlight.current = null;
    wanted.current = null;
    setStill(null);
    setWaiting(false);
  }, [stream]);

  const send = useCallback(() => {
    const asked = wanted.current;
    if (!asked) {
      return;
    }
    wanted.current = null;
    inFlight.current = asked.bucket;
    const sent = generation.current;

    const answered = (image: string | null) => {
      if (sent !== generation.current) {
        return;
      }
      rememberStill(cache.current, asked.bucket, image);
      inFlight.current = null;
      if (hovered.current === asked.bucket) {
        setStill(image === null ? null : { bucket: asked.bucket, image });
        setWaiting(false);
      }
      // The newest ask the pointer made while this one was in flight: after the
      // answer, never before it, so the Host keeps one capture in flight.
      if (wanted.current && wanted.current.bucket !== asked.bucket) {
        send();
      }
    };

    void asking.current({ type: "preview", at: asked.at }).then(
      (outcome) => {
        answered(answeredPreview(outcome.response)?.image ?? null);
        // A refusal is not drawn: the still is absent, which is exactly what a
        // preview that could not be produced is (ADR-0028).
      },
      () => answered(null),
    );
  }, []);

  const point = useCallback(
    (at: number | null) => {
      if (at === null || stream === null || !Number.isFinite(at)) {
        hovered.current = null;
        setWaiting(false);
        return;
      }

      const bucket = previewBucket(at);
      hovered.current = bucket;
      const known = cache.current.get(bucket);
      if (known !== undefined) {
        setStill(known === null ? null : { bucket, image: known });
        setWaiting(false);
        return;
      }

      // The previous still stays while this bucket is not ready: the tooltip
      // dims it rather than blinking empty.
      setWaiting(true);
      wanted.current = { bucket, at };
      if (inFlight.current === null) {
        send();
      }
    },
    [send, stream],
  );

  return { still, waiting, point };
}
