import { explain, type ActionError } from "../core/errors";
import { Button } from "../kit/Button";

/**
 * The two pieces of a row's furniture both new screens draw (#207).
 *
 * `RemoteRail` owns the rail's head, its cards and its trailing control's slot;
 * these fill the two slots a feed row needs: the line where its cards are
 * missing, and the plate that asks for another page. They are drawing, not
 * copy — the words come from the screen that chose them.
 */

/**
 * A row's line under its head: the Host's own words where an answer failed, a
 * quiet line where the screen has something to say, and nothing while the row
 * has cards to draw.
 */
export function RowNote({
  failure,
  quiet,
}: {
  failure: ActionError | null;
  quiet: string | null;
}) {
  if (failure) {
    return (
      <p role="alert" className="remote-rail-failure">
        {explain(failure)}
      </p>
    );
  }
  if (quiet === null) {
    return null;
  }
  return (
    <p role="status" className="remote-rail-quiet">
      {quiet}
    </p>
  );
}

/**
 * The rail's last plate: one press opens the row as a whole, as a pushed grid
 * (#253, design system *Rail*). It asks for no page itself — the grid's own
 * head action does that, over the cards the rail has read.
 */
export function MoreControl({
  label,
  onOpen,
}: {
  label: string;
  onOpen: () => void;
}) {
  return (
    <Button
      variant="ghost"
      className="remote-more"
      aria-label={`More ${label}`}
      onClick={onOpen}
    >
      More
    </Button>
  );
}
