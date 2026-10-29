/**
 * One section head in the programme: a printed index, a display-serif name, a
 * rule, and the bookkeeping at the right in mono. Home's rows, Discover's
 * fed sections and the Streams level's Addon groups all read the same way.
 */

export function RowHead({ index, title, tag }: { index: string; title: string; tag: string }) {
  return (
    <header className="rep-row-head">
      <span className="rep-row-index">{index}</span>
      <h2 className="rep-row-title">{title}</h2>
      <span className="rep-rule" aria-hidden="true" />
      <span className="rep-row-tag">{tag}</span>
    </header>
  );
}
