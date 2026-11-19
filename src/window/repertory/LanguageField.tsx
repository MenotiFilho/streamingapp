import { useRef, useState, type PointerEvent } from "react";

import {
  chips,
  dropIndex,
  move,
  remove,
  type LanguageKind,
} from "../../core/languageList";
import { chipMarks, type DragOver } from "../../core/chipGeometry";
import { chipRects } from "../../core/react/chipRects";
import { FOLLOW_THE_FILE } from "../../core/languages";
import { LANGUAGE_TITLES } from "./languageTitles";
import "./languages.css";

/** How far a press travels before it is a drag and not a press. */
const DRAG_SLOP = 6;

type Drag = { from: number; startX: number; startY: number; moved: boolean };

/**
 * The field: a line of ranked chips, each with a × to take it out, and a
 * trailing ▾ that opens the drawer where there is one. Pointer drag reorders
 * the chips; the keyboard and the pad reorder in the drawer instead, so the
 * field's own focus stops are each chip's × and then ▾, walked Left and Right.
 *
 * The decisions — which list a press makes, where a drop lands — are
 * `src/core/languageList`; this draws them and reads the chips' rectangles.
 */
export function LanguageField({
  kind,
  list,
  regionId,
  onChange,
  onOpen,
}: {
  kind: LanguageKind;
  list: readonly string[];
  /** The focus region's id: unique across the page and the drawer. */
  regionId: string;
  onChange: (next: string[] | null) => void;
  /** The ▾; a field with nowhere to open (the drawer's own) draws none. */
  onOpen?: () => void;
}) {
  const title = LANGUAGE_TITLES[kind];
  const field = useRef<HTMLDivElement | null>(null);
  const drag = useRef<Drag | null>(null);
  const [over, setOver] = useState<DragOver | null>(null);
  const drawn = chips(list);
  const marks = (index: number) => chipMarks(over, index);

  const rects = () => chipRects(field.current);

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
    drag.current = {
      from: Number(chip.dataset.chipIndex),
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
  };

  const travelled = (event: PointerEvent<HTMLDivElement>, held: Drag) =>
    Math.hypot(event.clientX - held.startX, event.clientY - held.startY) >= DRAG_SLOP;

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held || (!held.moved && !travelled(event, held))) {
      return;
    }
    if (!held.moved) {
      held.moved = true;
      // Capture only once this is a drag, so a press on a × still clicks.
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    const to = dropIndex(rects(), { x: event.clientX, y: event.clientY }, held.from);
    setOver((now) => (now?.to === to ? now : { from: held.from, to }));
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    drag.current = null;
    setOver(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    if (!held || !(held.moved || travelled(event, held))) {
      return;
    }
    const to = dropIndex(rects(), { x: event.clientX, y: event.clientY }, held.from);
    onChange(move(list, held.from, to));
  };

  const onPointerCancel = (event: PointerEvent<HTMLDivElement>) => {
    drag.current = null;
    setOver(null);
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  return (
    <div
      ref={field}
      className="rep-lang-field"
      data-testid={`language-field-${kind}`}
      data-region={regionId}
      data-kind="row"
      data-label={title}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
    >
      {drawn.length === 0 ? (
        <span className="rep-lang-follow" data-testid={`language-follow-${kind}`}>
          {FOLLOW_THE_FILE}
        </span>
      ) : (
        drawn.map((chip) => (
          <span
            key={chip.tag}
            className="rep-lang-chip"
            data-chip-index={chip.index}
            data-dragging={marks(chip.index).dragging ? "" : undefined}
            data-drop={marks(chip.index).drop ? "" : undefined}
          >
            <span className="rep-lang-rank">{chip.rank}</span>
            <span className="rep-lang-name">{chip.name}</span>
            <button
              type="button"
              className="rep-lang-x"
              data-focusable
              data-testid={`language-remove-${kind}-${chip.tag}`}
              aria-label={`Remove ${chip.name}`}
              onClick={() => onChange(remove(list, chip.index))}
            >
              ×
            </button>
          </span>
        ))
      )}
      {onOpen ? (
        <button
          type="button"
          className="rep-lang-open"
          data-focusable
          data-testid={`language-open-${kind}`}
          aria-label={`Choose ${title.toLowerCase()}`}
          aria-haspopup="dialog"
          onClick={onOpen}
        >
          ▾
        </button>
      ) : null}
    </div>
  );
}
