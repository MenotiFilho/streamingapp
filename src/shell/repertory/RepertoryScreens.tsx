import type { Destination } from "../navigation";
import { RepertoryAddonsScreen } from "./RepertoryAddons";
import { RepertoryDiscoverScreen, RepertorySearchScreen } from "./RepertoryFeed";
import { RepertoryHome } from "./RepertoryHome";
import { RepertoryLibraryScreen } from "./RepertoryLibrary";
import { RepertorySettingsScreen } from "./RepertorySettings";
import "./repertory.css";

/** The base screen under the repertory frame: every destination now has one. */
export function RepertoryDestinationScreen({ destination }: { destination: Destination }) {
  switch (destination) {
    case "home":
      return <RepertoryHome />;
    case "discover":
      return <RepertoryDiscoverScreen />;
    case "search":
      return <RepertorySearchScreen />;
    case "library":
      return <RepertoryLibraryScreen />;
    case "addons":
      return <RepertoryAddonsScreen />;
    case "settings":
      return <RepertorySettingsScreen />;
  }
}
