/**
 * When a client draws that the Stream is Stalled (ADR-0033).
 *
 * The Host publishes `stalled` as the Player reports it, with no debounce, and
 * a seek's brief wait for bytes reports it too. What a client draws is its own
 * decision, here, and the same for both: nothing until the stall has lasted one
 * continuous second. The window's centred card and the Remote's note and strip
 * all read it, so they cannot disagree about whether a held picture is news.
 */

/** How long Stalled must have lasted, unbroken, before anything is drawn. */
export const STALL_GRACE_MS = 1000;

/** What the window's card and the Remote's card say while the Stream waits. */
export const STALLED_NOTE = "Waiting for the Stream…";

/** What the Remote's docked strip says while the Stream waits. */
export const STALLED_STRIP_NOTE = "Waiting…";

/**
 * Whether the Stalled drawing is up.
 *
 * `stalledSince` is when this stall began on the client's own monotonic clock,
 * `null` while the Stream is not Stalled; an unstall is it going back to `null`,
 * which is what resets the second for the next stall.
 */
export function stallShown(stalledSince: number | null, now: number): boolean {
  return stalledSince !== null && now - stalledSince >= STALL_GRACE_MS;
}
