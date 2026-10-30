import { animate } from "motion/react";
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

import { useReducedMotion } from "../../useReducedMotion";
import { Icon } from "../icons";
import { panel } from "../motion";
import { cx } from "./cx";

export type RowTrackProps = {
  /** The row's heading: a Catalog's name, or `Continue watching`. */
  title: string;
  /** The programme's numbered section head, where the row has one. */
  index?: string;
  /** The Addon attribution beside the heading, where the row has one. */
  tag?: string | null;
  /** The trailing control, where the row can page on. */
  action?: ReactNode;
  /** The cards. Each becomes one item in the horizontal track. */
  children: ReactNode;
  /** How many cards one view holds. The cards share the width equally. */
  columns?: number;
  className?: string;
  /** A stable id for a screen's tests. */
  testId?: string;
};

type Playback = { stop: () => void };

/**
 * One horizontal row track: a numbered section head over a rail of cards.
 *
 * A view always holds the same number of cards (`columns`), each taking an equal
 * share of the width, so a row never ends in a clipped half-card. The track has
 * no scrollbar and no snapping: a mouse drag moves it directly, and the two edge
 * buttons page it one view at a time. Paging runs Motion's `animate()` on the
 * track's scroll offset with the panel preset, so a second press redirects the
 * rail mid-flight; a reduced-motion window jumps instead. The block padding
 * leaves the focus keyline room to show.
 */
export function RowTrack({
  title,
  index,
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
  const paging = useRef<Playback | null>(null);
  const pagingRun = useRef(0);
  const reducedMotion = useReducedMotion();
  const [edges, setEdges] = useState({ start: true, end: true });

  const measure = useCallback(() => {
    const node = track.current;
    if (!node) {
      return;
    }
    const start = node.scrollLeft <= 1;
    const end = node.scrollLeft + node.clientWidth >= node.scrollWidth - 1;
    // A page animation writes the offset every frame; only an edge that moves
    // is a reason to render again.
    setEdges((previous) =>
      previous.start === start && previous.end === end ? previous : { start, end },
    );
  }, []);

  useEffect(() => {
    measure();
  }, [measure, items.length, columns]);

  useEffect(() => {
    const onResize = () => measure();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [measure]);

  // A page jump that is still in flight is stopped on unmount: the node it
  // moves is about to leave the document.
  useEffect(
    () => () => {
      paging.current?.stop();
      paging.current = null;
    },
    [],
  );

  const stopPaging = () => {
    paging.current?.stop();
    paging.current = null;
    pagingRun.current += 1;
  };

  const scrollView = (direction: -1 | 1) => {
    const node = track.current;
    if (!node) {
      return;
    }
    const furthest = Math.max(0, node.scrollWidth - node.clientWidth);
    const target = Math.min(
      furthest,
      Math.max(0, Math.round(node.scrollLeft + node.clientWidth * direction)),
    );

    stopPaging();
    if (reducedMotion) {
      node.scrollLeft = target;
      measure();
      return;
    }

    const run = pagingRun.current;
    paging.current = animate(node.scrollLeft, target, {
      ...panel(),
      onUpdate: (value) => {
        node.scrollLeft = value;
      },
      onComplete: () => {
        if (pagingRun.current === run) {
          paging.current = null;
        }
      },
    });
  };

  const onPointerDown = (event: PointerEvent<HTMLUListElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }
    // A hand on the rail wins over a page that is still travelling.
    stopPaging();
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
    <section className={cx("rep-kit-row", className)} aria-labelledby={headingId} data-testid={testId}>
      <header className="rep-kit-row-head">
        {index ? <span className="rep-kit-row-index">{index}</span> : null}
        <h2 id={headingId} className="rep-kit-row-title">
          {title}
        </h2>
        <span className="rep-kit-row-rule" aria-hidden="true" />
        {tag ? <span className="rep-kit-row-tag">{tag}</span> : null}
        {action ? <div className="rep-kit-row-action">{action}</div> : null}
      </header>

      <div className="rep-kit-row-viewport">
        <button
          type="button"
          className="rep-kit-row-arrow rep-kit-row-arrow-left"
          data-focusable
          aria-label={`Scroll ${title} left`}
          disabled={edges.start}
          onClick={() => scrollView(-1)}
        >
          <Icon name="back" />
        </button>

        <ul
          ref={track}
          className="rep-kit-row-track"
          style={style}
          onScroll={measure}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onClickCapture={onClickCapture}
        >
          {items.map((item, itemIndex) => {
            const key = isValidElement(item) && item.key !== null ? item.key : itemIndex;
            return (
              <li className="rep-kit-row-item" key={key}>
                {item}
              </li>
            );
          })}
        </ul>

        <button
          type="button"
          className="rep-kit-row-arrow rep-kit-row-arrow-right"
          data-focusable
          aria-label={`Scroll ${title} right`}
          disabled={edges.end}
          onClick={() => scrollView(1)}
        >
          <Icon name="chevron" />
        </button>
      </div>
    </section>
  );
}
