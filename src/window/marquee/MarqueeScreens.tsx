import type { Destination } from "../navigation";
import { MarqueeAddons } from "./MarqueeAddons";
import { MarqueeDiscover } from "./MarqueeDiscover";
import { MarqueeHome } from "./MarqueeHome";
import { MarqueeLibrary } from "./MarqueeLibrary";
import { MarqueeSearch } from "./MarqueeSearch";
import { MarqueeSettings } from "./MarqueeSettings";
export { MarqueeStreamsLoader, MarqueeStreamsScreen } from "./MarqueeStreams";
export {
  MarqueeTitleLoading,
  MarqueeTitleScreen,
  marqueeTitleLevelOf,
  useMarqueeTitleOpener,
} from "./MarqueeTitle";

/**
 * The base screen under the Marquee frame: Home (#358), Discover, Search,
 * Library (#359), Addons and Settings (#361).
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
      return <MarqueeAddons />;
    case "settings":
      return <MarqueeSettings />;
  }
}
