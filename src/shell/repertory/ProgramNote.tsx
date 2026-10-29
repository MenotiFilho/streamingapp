/**
 * A program note: the prototype's stand-in for the Title page.
 *
 * The ticket draws the frame and Home, not Title anatomy. Opening a poster
 * therefore pushes this level so the frame's stack can be seen working — it is
 * deliberately labelled a note, and says what it is not. Back or Close pops it
 * to the exact focus it covered.
 */

export type ProgramNoteProps = {
  name: string;
  art: string | null;
  poster: string | null;
  year: string | null;
  rating: string | null;
  genres: string | null;
  description: string | null;
  onClose: () => void;
};

export function ProgramNote({
  name,
  art,
  poster,
  year,
  rating,
  genres,
  description,
  onClose,
}: ProgramNoteProps) {
  const picture = art ?? poster;
  return (
    <section
      className="rep-note"
      data-region="program-note"
      data-kind="branch"
      data-label="Program note"
      aria-label={`Program note: ${name}`}
    >
      <div className="rep-note-art">
        {picture ? (
          <img src={picture} alt="" />
        ) : (
          <span className="rep-art-missing">{name}</span>
        )}
      </div>
      <div className="rep-note-body">
        <button type="button" className="rep-note-close" data-focusable onClick={onClose}>
          Close
        </button>
        <p className="rep-note-kicker">Program note</p>
        <h2 className="rep-note-title">{name}</h2>
        {year || rating || genres ? (
          <p className="rep-note-meta">
            {year ? <span>{year}</span> : null}
            {rating ? <span>{rating}</span> : null}
            {genres ? <span>{genres}</span> : null}
          </p>
        ) : null}
        <p className="rep-note-description">
          {description ?? "The Addon sent no description for this Title."}
        </p>
        <p className="rep-note-boundary">
          The Title page is not part of this prototype. This note exists to show the frame&rsquo;s
          level stack; the next ticket draws the Title itself.
        </p>
      </div>
    </section>
  );
}
