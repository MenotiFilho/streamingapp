import type { ReactNode } from "react";

import { HomeScreen } from "./Home";
import { useShell } from "./context";
import { destinationLabel, type Destination } from "./navigation";

/**
 * The base screen for one destination.
 *
 * Home is built (#80); the other destinations are the shell's honest
 * placeholders until their tickets fill them in. The words still say what the
 * Host holds, so the frame can be driven and looked at without pretending a
 * screen is finished.
 */
export function DestinationScreen({ destination }: { destination: Destination }) {
  const { snapshot } = useShell();

  switch (destination) {
    case "home":
      return <HomeScreen />;
    case "discover": {
      const keyed = snapshot?.protection.tmdbHeld ?? false;
      return (
        <Screen
          destination="discover"
          lede="Discover is TMDB's weekly Trending feed, with a Movie or Series kind and a genre filter."
        >
          {snapshot ? (
            <p className="shell-note" data-testid="discover-key-state">
              {keyed
                ? "A TMDB key is held, so Discover can ask TMDB."
                : "No TMDB key is held, so Discover has nothing to ask yet."}
            </p>
          ) : null}
        </Screen>
      );
    }
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
    case "library": {
      const signedIn = snapshot?.protection.stremioHeld ?? false;
      return (
        <Screen
          destination="library"
          lede={
            signedIn
              ? "Signed in to Stremio. Library membership is not built yet, so this screen holds no collection."
              : "Library needs a Stremio account. Sign in to hold one."
          }
        />
      );
    }
    case "addons":
      return (
        <Screen
          destination="addons"
          lede="An Addon's manifest URL adds it; the Host keeps the Addons and their order."
        >
          <p className="shell-note" data-testid="addons-summary">
            {snapshot
              ? snapshot.addons.length === 0
                ? "No Addons are configured yet."
                : `${snapshot.addons.length} ${snapshot.addons.length === 1 ? "Addon is" : "Addons are"} configured.`
              : "Waiting for the Host…"}
          </p>
        </Screen>
      );
    case "settings":
      return (
        <Screen
          destination="settings"
          lede="Settings holds Credentials, Preferences, Remote devices, and About/Credits."
        >
          <p className="shell-note" data-testid="settings-summary">
            {snapshot
              ? snapshot.protection.tmdbHeld
                ? "A TMDB key is held."
                : "No TMDB key is held."
              : "Waiting for the Host…"}
          </p>
        </Screen>
      );
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
