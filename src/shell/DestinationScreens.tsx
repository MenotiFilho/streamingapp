import { AddonsScreen } from "./AddonsScreen";
import { DiscoverScreen } from "./DiscoverScreen";
import { HomeScreen } from "./Home";
import { LibraryScreen } from "./LibraryScreen";
import { SearchScreen } from "./SearchScreen";
import { SettingsScreen } from "./SettingsScreen";
import type { Destination } from "./navigation";

/**
 * The base screen for one destination.
 *
 * Home (#80), Discover (#85), Search (#86), Addons and Settings (#82), and
 * Library's sign-in-gated stub (#84) are built. Library remains a stub because
 * membership is not built: every other destination is a real screen.
 */
export function DestinationScreen({ destination }: { destination: Destination }) {
  switch (destination) {
    case "home":
      return <HomeScreen />;
    case "discover":
      return <DiscoverScreen />;
    case "search":
      return <SearchScreen />;
    case "library":
      return <LibraryScreen />;
    case "addons":
      return <AddonsScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}
