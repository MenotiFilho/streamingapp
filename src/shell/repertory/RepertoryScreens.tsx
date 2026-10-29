import { DESTINATIONS, type Destination } from "../navigation";
import { programIndex } from "./program";
import { RepertoryHome } from "./RepertoryHome";
import "./repertory.css";

const NOTES: Partial<Record<Destination, string>> = {
  discover:
    "Discover is TMDB's page of Discovered Titles. It keeps its Host behaviour and is not re-tuned in this prototype.",
  search:
    "Search keeps its Host behaviour: TMDB's answer where a credential is held, the Addons' own catalogs otherwise.",
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

/** The base screen under the repertory frame: Home, or a destination note. */
export function RepertoryDestinationScreen({ destination }: { destination: Destination }) {
  return destination === "home" ? <RepertoryHome /> : <Placeholder destination={destination} />;
}
