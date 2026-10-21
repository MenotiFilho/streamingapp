import {
  Children,
  isValidElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from "react";

import { cx } from "./cx";

export type RowTrackProps = {
  /** The row's heading: a Catalog's name, or `Continue watching`. */
  title: string;
  /** The Addon attribution beside the heading, where the row has one. */
  tag?: string | null;
  /** The `More` control, where the row can page on. */
  action?: ReactNode;
  /** The cards. Each becomes one item in the horizontal track. */
  children: ReactNode;
  /** How many cards one view holds. The cards share the width equally. */
  columns?: number;
  className?: string;
  /** A stable id for a screen's tests. */
  testId?: string;
};

/**
 * One horizontal row track: a heading with its optional Addon tag and trailing
 * action, over a track of cards that fills the screen.
 *
 * A view always holds the same number of cards (`columns`), each taking an equal
 * share of the width, so a row never ends in a clipped half-card. The track has
 * no scrollbar: a mouse drag moves it, and the two edge buttons move it one view
 * at a time. The block padding leaves the focus ring room to show.
 *
 * It is named `RowTrack` rather than `Row` because the browse model already
 * owns `Row` (`src/browse.ts`): a screen holds a Catalog's answer as a `Row` and
 * draws it with a `RowTrack`, and neither name is ambiguous at the call site.
 */
export function RowTrack({
  title,
  tag,
  action,
  children,
  columns = 7,
  className,
  testId,
}: RowTrackProps) {
  const headingId = useId();
  const items = Children.toArray(children);
  const track = useRef<HTMLUListElement | null>(null);
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 });
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const node = track.current;
    if (!node) {
      return;
    }
    setEdges({
      start: node.scrollLeft <= 1,
      end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 1,
    });
  }, []);

  useEffect(() => {
    measure();
  }, [measure, items.length]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  const scrollView = (direction: -1 | 1) => {
    const node = track.current;
    if (!node) {
      return;
    }
    const amount = Math.max(1, node.clientWidth - 16) * direction;
    if (typeof node.scrollBy === "function") {
      node.scrollBy({ left: amount, behavior: "smooth" });
    } else {
      node.scrollLeft += amount;
    }
  };

  const onPointerDown = (event: PointerEvent<HTMLUListElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    const node = event.currentTarget;
    drag.current = {
      active: true,
      moved: false,
      startX: event.clientX,
      startLeft: node.scrollLeft,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLUListElement>) => {
    if (!drag.current.active) {
      return;
    }
    const movedBy = event.clientX - drag.current.startX;
    if (!drag.current.moved && Math.abs(movedBy) < 5) {
      return;
    }
    if (!drag.current.moved) {
      // Capture only once this is a drag: capturing on pointerdown would
      // retarget the click that a plain press on a card needs.
      drag.current.moved = true;
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    event.currentTarget.scrollLeft = drag.current.startLeft - movedBy;
  };

  const endDrag = (event: PointerEvent<HTMLUListElement>) => {
    if (!drag.current.active) {
      return;
    }
    drag.current.active = false;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
    measure();
  };

  // A drag that ends over a card is not a press on that card: the click the
  // browser is about to fire is swallowed, so pulling the row never opens a
  // Title by accident.
  const onClickCapture = (event: MouseEvent<HTMLUListElement>) => {
    if (drag.current.moved) {
      event.preventDefault();
      event.stopPropagation();
      drag.current.moved = false;
    }
  };

  const style = { "--row-visible": columns } as CSSProperties;

  return (
    <section
      className={cx("kit-row", className)}
      aria-labelledby={headingId}
      data-testid={testId}
    >
      <header className="kit-row-header">
        <div className="kit-row-heading-group">
          <h2 id={headingId} className="kit-row-title">
            {title}
          </h2>
          {tag ? <span className="kit-row-tag kit-tabular">{tag}</span> : null}
        </div>
        {action ? <div className="kit-row-action">{action}</div> : null}
      </header>

      <div className="kit-row-viewport">
        <button
          type="button"
          className="kit-row-arrow kit-row-arrow-left kit-focus-invert"
          data-focusable
          aria-label={`Scroll ${title} left`}
          disabled={edges.start}
          onClick={() => scrollView(-1)}
        >
          <Chevron direction="left" />
        </button>

        <ul
          ref={track}
          className="kit-row-track"
          style={style}
          onScroll={measure}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={onClickCapture}
        >
          {items.map((item, index) => {
            const key = isValidElement(item) && item.key !== null ? item.key : index;
            return (
              <li className="kit-row-item" key={key}>
                {item}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="kit-row-arrow kit-row-arrow-right kit-focus-invert"
          data-focusable
          aria-label={`Scroll ${title} right`}
          disabled={edges.end}
          onClick={() => scrollView(1)}
        >
          <Chevron direction="right" />
        </button>
      </div>
    </section>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
      <path d={direction === "left" ? "M15 5l-7 7 7 7" : "M9 5l7 7-7 7"} />
    </svg>
  );
}
