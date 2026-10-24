/**
 * The ring a control draws while the Action it sent is in flight (#137).
 *
 * One element so the kit's button, the player's icon buttons and a Stream row
 * cannot drift into three different waits.
 */
export function PendingSpinner() {
  return <span className="kit-spinner" aria-hidden="true" />;
}
