import { DESTINATION_NOTES } from "../core/destinationNotes";
import type { Destination } from "../core/destinations";
import { destinationLabel } from "../core/navigation";

/**
 * What a destination is called and what it will hold, until its screen lands.
 *
 * B1 walks the skeleton: the six destinations exist, the navigation between
 * them is real, and each one draws its own name and the line the design record
 * gives it. B2–B7 replace these one at a time, which is why the decision is a
 * function over the core's own lists rather than a copy table.
 */
export type Placeholder = { title: string; note: string };

/** The name and the programme line of one destination. */
export function placeholderFor(destination: Destination): Placeholder {
  return {
    title: destinationLabel(destination),
    note: DESTINATION_NOTES[destination],
  };
}

/** One destination, drawn as the skeleton it still is. */
export function RemoteDestination({ destination }: { destination: Destination }) {
  const { title, note } = placeholderFor(destination);

  return (
    <section className="remote-destination">
      <h1 className="remote-destination-title">{title}</h1>
      <p className="remote-destination-note">{note}</p>
      <p className="remote-destination-wait">Nothing is screening here yet.</p>
    </section>
  );
}
