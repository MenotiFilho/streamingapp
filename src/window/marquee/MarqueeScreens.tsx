import { destinationLabel } from "../../core/navigation";
import type { Destination } from "../navigation";
import { MarqueeDiscover } from "./MarqueeDiscover";
import { MarqueeHome } from "./MarqueeHome";
import { MarqueeLibrary } from "./MarqueeLibrary";
import { MarqueeSearch } from "./MarqueeSearch";
export { MarqueeStreamsLoader, MarqueeStreamsScreen } from "./MarqueeStreams";
export {
  MarqueeTitleLoading,
  MarqueeTitleScreen,
  marqueeTitleLevelOf,
  useMarqueeTitleOpener,
} from "./MarqueeTitle";

function MarqueePlaceholder({ destination }: { destination: Exclude<Destination, "home"> }) {
  const title = destinationLabel(destination);
  return (
    <section
      className="mq-placeholder"
      data-testid={`screen-${destination}`}
      data-region={`screen:${destination}`}
      data-kind="branch"
      data-label={title}
    >
      <h1 className="mq-type-screen-title mq-placeholder-title">{title}</h1>
      <p className="mq-type-body mq-text-muted mq-placeholder-note">
        {`${title} arrives in Wave 2b.`}
      </p>
    </section>
  );
}

/**
 * The base screen under the Marquee frame. Home (#358), Discover, Search and
 * Library (#359) are wired here; Addons and Settings arrive in #361.
 */
export function MarqueeDestinationScreen({ destination }: { destination: Destination }) {
  switch (destination) {
    case "home":
      return <MarqueeHome />;
    case "discover":
      return <MarqueeDiscover />;
    case "search":
      return <MarqueeSearch />;
    case "library":
      return <MarqueeLibrary />;
    case "addons":
    case "settings":
      return <MarqueePlaceholder destination={destination} />;
  }
}
