import type { ReactNode } from "react";

import { AddonsScreen } from "./AddonsScreen";
import { DiscoverScreen } from "./DiscoverScreen";
import { HomeScreen } from "./Home";
import { LibraryScreen } from "./LibraryScreen";
import { SettingsScreen } from "./SettingsScreen";
import { useShell } from "./context";
import { destinationLabel, type Destination } from "./navigation";

/**
 * The base screen for one destination.
 *
 * Home (#80), Discover (#85), Addons and Settings (#82), and Library's
 * sign-in-gated stub (#84) are built; Search is the shell's honest placeholder
 * until its ticket fills it in. The words still say what the Host holds, so the
 * frame can be driven and looked at without pretending a screen is finished.
 */
export function DestinationScreen({ destination }: { destination: Destination }) {
  const { snapshot } = useShell();

  switch (destination) {
    case "home":
      return <HomeScreen />;
    case "discover":
      return <DiscoverScreen />;
    case "search": {
      const keyed = snapshot?.protection.tmdbHeld ?? false;
      return (
        <Screen
          destination="search"
          lede={
            keyed
              ? "With a TMDB key held, Search asks TMDB for Movies and Series."
              : "Without a TMDB key, Search asks every Addon that offers a searchable Catalog."
          }
        >
          {!snapshot ? <p className="shell-note">Waiting for the Host…</p> : null}
        </Screen>
      );
    }
    case "library":
      return <LibraryScreen />;
    case "addons":
      return <AddonsScreen />;
    case "settings":
      return <SettingsScreen />;
  }
}

function Screen({
  destination,
  lede,
  children,
}: {
  destination: Destination;
  lede: string;
  children?: ReactNode;
}) {
  return (
    <section
      className="shell-screen-body"
      data-destination={destination}
      data-testid={`screen-${destination}`}
    >
      <h1 className="shell-screen-title">{destinationLabel(destination)}</h1>
      <p className="shell-lede">{lede}</p>
      {children}
    </section>
  );
}
