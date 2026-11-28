import { destinationLabel } from "../../core/navigation";
import type { Destination } from "../navigation";
import { MarqueeAddons } from "./MarqueeAddons";
import { MarqueeHome } from "./MarqueeHome";
import { MarqueeSettings } from "./MarqueeSettings";

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
 * The base screen under the Marquee frame. Home is wired here (#358);
 * Discover, Search, Library, Addons and Settings arrive in Wave 2b (#359, #361).
 */
export function MarqueeDestinationScreen({ destination }: { destination: Destination }) {
  switch (destination) {
    case "home":
      return <MarqueeHome />;
    case "addons":
      return <MarqueeAddons />;
    case "settings":
      return <MarqueeSettings />;
    case "discover":
    case "search":
    case "library":
      return <MarqueePlaceholder destination={destination} />;
  }
}
