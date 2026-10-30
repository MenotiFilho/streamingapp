/**
 * The ring a control draws while the Action it sent is in flight (#137).
 *
 * It is the one circle in the repertory system (design record §4): every other
 * corner is square, and the spinner is the wait a person sees instead of a press
 * that seemed to do nothing.
 */
export function PendingSpinner() {
  return (
    <span className="rep-kit-spinner" data-testid="pending-spinner" aria-hidden="true" />
  );
}
