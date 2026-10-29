import { DESTINATIONS, type Destination } from "../navigation";
import { programIndex } from "./program";
import { RepertoryDiscoverScreen, RepertorySearchScreen } from "./RepertoryFeed";
import { RepertoryHome } from "./RepertoryHome";
import "./repertory.css";

const NOTES: Partial<Record<Destination, string>> = {
  library:
    "Library membership is not built. The destination stays visible, as it does in the product, and this page is not part of the prototype.",
  addons:
    "Addons keeps its Host behaviour: add, reorder, feature and remove. This page is not re-tuned in this prototype.",
  settings:
    "Settings keeps its Host behaviour: credentials, playback preferences and paired devices. This page is not re-tuned in this prototype.",
};

function Placeholder({ destination }: { destination: Exclude<Destination, "home"> }) {
  const entry = DESTINATIONS.find((held) => held.id === destination);
  const index = DESTINATIONS.findIndex((held) => held.id === destination);
  return (
    <section className="rep-placeholder" data-testid={`repertory-placeholder-${destination}`}>
      <p className="rep-placeholder-index">{programIndex(index + 1)}</p>
      <h1 className="rep-placeholder-title">{entry?.label ?? destination}</h1>
      <p className="rep-placeholder-body">
        {NOTES[destination] ??
          "This page keeps its Host behaviour and is not part of the frame and Home prototype."}
      </p>
      <p className="rep-placeholder-body">
        The frame and the programme are the first slice; the rest of the destinations keep their
        existing screens.
      </p>
    </section>
  );
}

/** The base screen under the repertory frame: the four browse screens, or a note. */
export function RepertoryDestinationScreen({ destination }: { destination: Destination }) {
  if (destination === "home") {
    return <RepertoryHome />;
  }
  if (destination === "discover") {
    return <RepertoryDiscoverScreen />;
  }
  if (destination === "search") {
    return <RepertorySearchScreen />;
  }
  return <Placeholder destination={destination} />;
}
