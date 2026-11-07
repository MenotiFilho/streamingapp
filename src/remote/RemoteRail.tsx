import { Children, isValidElement, useId, type ReactNode } from "react";

/**
 * One touch rail: a section head over a horizontally scrolling line of cards.
 *
 * The window's rail is a ten-foot apparatus — a view of five and a half cards,
 * arrows at both edges, and a page that moves exactly five. A hand has none of
 * that: the list itself slides under the finger, and the only control at the end
 * of a row is the one that opens the row as a whole. So this is a plain scroll,
 * with no keyboard step of its own and no snap: a snap point fights the minimal
 * reveal the cut-off first press asks for (#245).
 *
 * The head is the programme's: the row's number in mono, the name in display
 * serif, a hairline to the trailing end, the tag the core prints and the quiet
 * action that asks the Host's next page (design system *Rail*). A row with no
 * cards yet, or a row whose Addon refused, keeps that head and draws its note in
 * the cards' place instead of an empty track.
 */
export type RemoteRailProps = {
  /** The programme's numbered section head, where the row has one. */
  index?: string;
  /** The row's heading: a Catalog's name, or `Continue watching`. */
  title: string;
  /** The bookkeeping beside the heading, as the core printed it. */
  tag?: string | null;
  /** A quiet line where the cards would be: a failure, an empty answer, or a wait. */
  note?: ReactNode;
  /** The quiet head action, where the row can page on. */
  action?: ReactNode;
  /** The More plate at the rail's end, where the row opens as a whole grid. */
  more?: ReactNode;
  /** The cards. Each becomes one item in the scrolling line. */
  children?: ReactNode;
  /** A stable id for a screen's tests. */
  testId?: string;
};

export function RemoteRail({
  index,
  title,
  tag,
  note,
  action,
  more,
  children,
  testId,
}: RemoteRailProps) {
  const headingId = useId();
  const items = Children.toArray(children);

  return (
    <section className="remote-rail" aria-labelledby={headingId} data-testid={testId}>
      <header className="remote-rail-head">
        {index ? <span className="remote-rail-index">{index}</span> : null}
        <h2 id={headingId} className="remote-rail-title">
          {title}
        </h2>
        <span className="remote-rail-rule" aria-hidden="true" />
        {tag ? <span className="remote-rail-tag">{tag}</span> : null}
        {action ? <div className="remote-rail-action">{action}</div> : null}
      </header>

      {note ? <div className="remote-rail-note">{note}</div> : null}

      {items.length > 0 || more ? (
        <ul className="remote-rail-track" data-kind="row">
          {items.map((item, itemIndex) => {
            const key =
              isValidElement(item) && item.key !== null ? item.key : itemIndex;
            return (
              <li className="remote-rail-item" key={key}>
                {item}
              </li>
            );
          })}
          {more ? (
            <li className="remote-rail-item remote-rail-more">{more}</li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
