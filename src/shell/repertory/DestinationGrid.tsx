import { DESTINATIONS, type Destination } from "../navigation";
import { DESTINATION_NOTES } from "./destinationNotes";
import { Icon } from "./icons";
import { programIndex } from "./program";

/**
 * The whole program index, opened from **All destinations** at the foot of the
 * spine. It is a pushed level like any other: Back returns to the control that
 * opened it, and choosing a room replaces the base screen and closes the grid.
 */
export function DestinationGrid({
  active,
  onChoose,
  onClose,
}: {
  active: Destination;
  onChoose: (destination: Destination) => void;
  onClose: () => void;
}) {
  return (
    <section
      className="rep-destinations"
      data-region="destinations"
      data-kind="branch"
      data-label="All destinations"
      aria-label="All destinations"
    >
      <header className="rep-destinations-head">
        <p className="rep-destinations-kicker">The programme</p>
        <h2 className="rep-destinations-title">All destinations</h2>
      </header>

      <div className="rep-destinations-grid">
        {DESTINATIONS.map((destination, index) => (
          <button
            key={destination.id}
            type="button"
            className="rep-destination"
            data-focusable
            data-destination={destination.id}
            aria-current={active === destination.id ? "page" : undefined}
            onClick={() => onChoose(destination.id)}
          >
            <span className="rep-destination-icon" aria-hidden="true">
              <Icon name={destination.id} />
            </span>
            <span className="rep-destination-number">{programIndex(index + 1)}</span>
            <span className="rep-destination-label">{destination.label}</span>
            <span className="rep-destination-note">{DESTINATION_NOTES[destination.id]}</span>
          </button>
        ))}
      </div>

      <button type="button" className="rep-button rep-destinations-close" data-focusable onClick={onClose}>
        Close
      </button>
    </section>
  );
}
