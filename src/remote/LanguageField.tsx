import { useEffect, useRef, useState, type PointerEvent } from "react";

import { chips, dropIndex, move, remove, type LanguageKind } from "../core/languageList";
import { FOLLOW_THE_FILE } from "../core/languages";
import { LANGUAGE_GROUP_HEADS, LONG_PRESS_MS, pressVerdict } from "./settingsScreen";

/** What a press on a chip is doing: waiting to become a drag, or carrying one. */
type Press = {
  from: number;
  pointerId: number;
  startX: number;
  startY: number;
  startedAt: number;
  x: number;
  y: number;
  dragging: boolean;
  timer: number | undefined;
};

/** A finger's drift from where it landed, in CSS pixels. */
function travelled(press: Press): number {
  return Math.hypot(press.x - press.startX, press.y - press.startY);
}

/**
 * The field: a line of ranked chips, each with a × to take it out, and a
 * trailing ▾ that opens the sheet (#330). It is the window's field on a phone:
 * the same chips, drawn from `core/languageList`.
 *
 * A finger lands on a chip all the time on its way to scrolling the page, so a
 * drag starts only on a long press — held about half a second without
 * travelling (`pressVerdict`). A swipe before that is the page's: the press is
 * dropped and the chip is never picked up. Once a chip is lifted the page stops
 * scrolling under the finger. Reordering has a second way that needs no drag:
 * the sheet's tick list.
 */
export function LanguageField({
  kind,
  list,
  onChange,
  onOpen,
}: {
  kind: LanguageKind;
  list: readonly string[];
  /** The next whole list, or `null` where the press changes nothing. */
  onChange: (next: string[] | null) => void;
  onOpen: () => void;
}) {
  const title = LANGUAGE_GROUP_HEADS[kind];
  const field = useRef<HTMLDivElement | null>(null);
  const press = useRef<Press | null>(null);
  const [over, setOver] = useState<{ from: number; to: number } | null>(null);
  const drawn = chips(list);

  const rects = () =>
    Array.from(field.current?.querySelectorAll<HTMLElement>("[data-chip-index]") ?? [], (chip) => {
      const box = chip.getBoundingClientRect();
      return { x: box.left, y: box.top, w: box.width, h: box.height };
    });

  const dropOf = (held: Press) => dropIndex(rects(), { x: held.x, y: held.y }, held.from);

  const release = () => {
    const held = press.current;
    if (held?.timer !== undefined) {
      window.clearTimeout(held.timer);
    }
    press.current = null;
    setOver(null);
  };

  /** Pick the chip up if the press has become a drag. */
  const lift = () => {
    const held = press.current;
    if (!held || held.dragging) {
      return;
    }
    const verdict = pressVerdict({ heldMs: Date.now() - held.startedAt, travelled: travelled(held) });
    if (verdict === "scroll") {
      release();
      return;
    }
    if (verdict === "drag") {
      held.dragging = true;
      field.current?.setPointerCapture?.(held.pointerId);
      navigator.vibrate?.(12);
      setOver({ from: held.from, to: dropOf(held) });
    }
  };

  // The page scrolls under a finger unless a touch move is cancelled, and React
  // listens passively: a lifted chip stops the scroll from here.
  useEffect(() => {
    const node = field.current;
    const stop = (event: TouchEvent) => {
      if (press.current?.dragging && event.cancelable) {
        event.preventDefault();
      }
    };
    node?.addEventListener("touchmove", stop, { passive: false });
    return () => node?.removeEventListener("touchmove", stop);
  }, []);

  useEffect(() => release, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const target = event.target as HTMLElement;
    const chip = target.closest<HTMLElement>("[data-chip-index]");
    // The × is its own press; only the rest of the chip is a handle.
    if (!chip || target.closest("button")) {
      return;
    }
    release();
    const held: Press = {
      from: Number(chip.dataset.chipIndex),
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startedAt: Date.now(),
      x: event.clientX,
      y: event.clientY,
      dragging: false,
      timer: undefined,
    };
    held.timer = window.setTimeout(lift, LONG_PRESS_MS);
    press.current = held;
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = press.current;
    if (!held) {
      return;
    }
    held.x = event.clientX;
    held.y = event.clientY;
    if (!held.dragging) {
      lift();
      return;
    }
    const to = dropOf(held);
    setOver((now) => (now?.to === to ? now : { from: held.from, to }));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const held = press.current;
    if (!held) {
      return;
    }
    held.x = event.clientX;
    held.y = event.clientY;
    const dropped = held.dragging;
    const to = dropOf(held);
    field.current?.releasePointerCapture?.(event.pointerId);
    release();
    if (dropped) {
      onChange(move(list, held.from, to));
    }
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    field.current?.releasePointerCapture?.(event.pointerId);
    release();
  };

  return (
    <div
      ref={field}
      className="remote-lang-field"
      data-testid={`language-field-${kind}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onContextMenu={(event) => {
        // A long press is how a chip is lifted, not how a menu is opened.
        if (press.current) {
          event.preventDefault();
        }
      }}
    >
      {drawn.length === 0 ? (
        <span className="remote-lang-follow">{FOLLOW_THE_FILE}</span>
      ) : (
        drawn.map((chip) => (
          <span
            key={chip.tag}
            className="remote-lang-chip"
            data-chip-index={chip.index}
            data-dragging={over?.from === chip.index ? "" : undefined}
            data-drop={over && over.to === chip.index && over.from !== chip.index ? "" : undefined}
          >
            <span className="remote-lang-rank">{chip.rank}</span>
            <span className="remote-lang-name">{chip.name}</span>
            <button
              type="button"
              className="remote-lang-x"
              data-testid={`language-remove-${kind}-${chip.tag}`}
              aria-label={`Remove ${chip.name}`}
              onClick={() => onChange(remove(list, chip.index))}
            >
              ×
            </button>
          </span>
        ))
      )}
      <button
        type="button"
        className="remote-lang-open"
        data-testid={`language-open-${kind}`}
        aria-label={`Choose ${title.toLowerCase()}`}
        aria-haspopup="dialog"
        onClick={onOpen}
      >
        ▾
      </button>
    </div>
  );
}
