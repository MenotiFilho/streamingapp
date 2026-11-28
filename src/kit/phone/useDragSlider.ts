import {
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { pointerRatio } from "./seekMath";

export type DragSliderOptions = {
  /** What the Host last said, in the slider's own units. */
  value: number;
  /** Whether a finger or a key may move it at all. */
  enabled: boolean;
  /** The value a fraction of the track names. */
  valueAt: (ratio: number) => number;
  /** The value a key moves to, or null for a key that is not the slider's. */
  keyTarget: (key: string, from: number) => number | null;
  /** Taken once, when the finger lifts or the key is released. */
  onCommit: (value: number) => void;
};

/**
 * One drag is one change (sheet `C8`, "the Host seeks when the finger lifts").
 *
 * While a finger or a key holds the slider the draft is what is drawn; the
 * release commits it once and drops it, so the next Snapshot is what shows. A
 * cancelled gesture, which is how the browser hands a swipe to the page's own
 * scroll, commits nothing.
 */
export function useDragSlider({ value, enabled, valueAt, keyTarget, onCommit }: DragSliderOptions) {
  const [draft, setDraft] = useState<number | null>(null);
  const held = useRef<number | null>(null);
  const pointer = useRef<number | null>(null);

  const hold = (next: number | null) => {
    held.current = next;
    setDraft(next);
  };
  const abandon = () => {
    pointer.current = null;
    hold(null);
  };
  const commit = () => {
    const next = held.current;
    abandon();
    if (next !== null && enabled) {
      onCommit(next);
    }
  };
  const at = (event: ReactPointerEvent<HTMLElement>) => {
    const track = event.currentTarget.getBoundingClientRect();
    return valueAt(pointerRatio(event.clientX, track.left, track.width));
  };

  return {
    /** The value to draw: the finger's draft, else the Host's. */
    shown: enabled ? (draft ?? value) : value,
    dragging: enabled && draft !== null,
    handlers: {
      onPointerDown(event: ReactPointerEvent<HTMLElement>) {
        if (!enabled || event.button !== 0) {
          return;
        }
        pointer.current = event.pointerId;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        hold(at(event));
      },
      onPointerMove(event: ReactPointerEvent<HTMLElement>) {
        if (pointer.current === event.pointerId) {
          hold(at(event));
        }
      },
      onPointerUp(event: ReactPointerEvent<HTMLElement>) {
        if (pointer.current === event.pointerId) {
          hold(at(event));
          commit();
        }
      },
      onPointerCancel(event: ReactPointerEvent<HTMLElement>) {
        if (pointer.current === event.pointerId) {
          abandon();
        }
      },
      onLostPointerCapture(event: ReactPointerEvent<HTMLElement>) {
        if (pointer.current === event.pointerId) {
          abandon();
        }
      },
      onKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
        const next = keyTarget(event.key, held.current ?? value);
        if (next === null) {
          return;
        }
        event.preventDefault();
        if (enabled) {
          hold(next);
        }
      },
      onKeyUp() {
        if (pointer.current === null) {
          commit();
        }
      },
      onBlur() {
        if (pointer.current === null) {
          commit();
        }
      },
    },
  };
}
