import { DESTINATION_NOTES } from "../core/destinationNotes";
import type { Destination } from "../core/destinations";
import { destinationLabel } from "../core/navigation";

/**
 * What a destination is called and what it will hold, until its screen lands.
 *
 * B1 walks the skeleton: the six destinations exist, the navigation between
 * them is real, and each one draws its own name and the line the design record
 * gives it. B2–B5 replaced Home, Discover, Search, Library and Addons; Settings
 * (B7) is the one still drawn from here, which is why the decision is a
 * function over the core's own lists rather than a copy table.
 */
export type Placeholder = { title: string; note: string };

/**
 * The one destination whose own screen has not landed yet: Settings (B7).
 * Writing it down here is what keeps "still a skeleton" a decision rather than
 * whatever the last branch happened to leave.
 */
export type RemainingDestination = Exclude<
  Destination,
  "home" | "discover" | "search" | "library" | "addons"
>;

/** The name and the programme line of one destination. */
export function placeholderFor(destination: Destination): Placeholder {
  return {
    title: destinationLabel(destination),
    note: DESTINATION_NOTES[destination],
  };
}

/** A destination whose screen has not landed, drawn as the skeleton it still is. */
export function RemoteDestination({
  destination,
}: {
  destination: RemainingDestination;
}) {
  const { title, note } = placeholderFor(destination);

  return (
    <section className="remote-destination">
      <h1 className="remote-destination-title">{title}</h1>
      <p className="remote-destination-note">{note}</p>
      <p className="remote-destination-wait">Nothing is screening here yet.</p>
    </section>
  );
}
