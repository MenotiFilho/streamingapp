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
 * The rail's quiet head action: the next page when there is one, or the failed
 * page again (design system *Rail*). It is disabled while that ask is in
 * flight, and it is drawn only where the source has a page to ask for.
 */
export function PagingControl({
  failure,
  more,
  loading,
  onMore,
}: {
  failure: ActionError | null;
  more: boolean;
  loading: boolean;
  onMore: () => void;
}) {
  if (!failure && !more) {
    return null;
  }
  return (
    <Button variant="ghost" disabled={loading} onClick={onMore}>
      {failure ? "Try again" : "Read on"}
    </Button>
  );
}

/**
 * The rail's last plate: one press opens the row as a whole, as a pushed grid
 * (#253, #264, design system *Rail*). The grid draws the same row the rail
 * draws and reads on by itself near its end; the rail's quiet head action
 * still pages the rail in place.
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
