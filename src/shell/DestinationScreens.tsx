import type { ReactNode } from "react";

import { Button } from "./kit";
import { useShell } from "./context";
import { destinationLabel, type Destination } from "./navigation";

/**
 * The base screen for one destination.
 *
 * These are the shell's honest placeholders: the frame, the rail and the level
 * stack are what #79 built, and each destination's own screen is filled in by
 * its ticket. The words still say what the Host holds, so the frame can be
 * driven and looked at without pretending a screen is finished.
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

function HomeScreen() {
  const { snapshot, choose } = useShell();
  const addons = snapshot?.addons.length ?? 0;
  const watching = snapshot?.watchProgress.length ?? 0;

  return (
    <Screen
      destination="home"
      lede={
        snapshot
          ? `The Host holds ${addons} ${addons === 1 ? "Addon" : "Addons"} and ${watching} Continue watching ${watching === 1 ? "entry" : "entries"}. The Featured hero and the Catalogs' rows are drawn from that Snapshot.`
          : "Waiting for the Host…"
      }
    >
      {snapshot && addons === 0 ? (
        <>
          <p className="shell-note" data-testid="home-no-addons">
            No Addons are configured, so Home has no Catalog to draw a row from.
          </p>
          <Button variant="primary" onClick={() => choose("addons")}>
            Open Addons
          </Button>
        </>
      ) : null}
    </Screen>
  );
}

function DiscoverScreen() {
  const { snapshot, choose } = useShell();
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
      {snapshot && !keyed ? (
        <Button onClick={() => choose("settings")}>Open Settings</Button>
      ) : null}
    </Screen>
  );
}

function SearchScreen() {
  const { snapshot } = useShell();
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

function LibraryScreen() {
  const { snapshot, choose } = useShell();
  const signedIn = snapshot?.protection.stremioHeld ?? false;

  return (
    <Screen
      destination="library"
      lede={
        signedIn
          ? "Signed in to Stremio. Library membership is not built yet, so this screen holds no collection."
          : "Library needs a Stremio account. Sign in to hold one."
      }
    >
      {snapshot && !signedIn ? (
        <Button onClick={() => choose("settings")}>Open Settings</Button>
      ) : null}
    </Screen>
  );
}

function AddonsScreen() {
  const { snapshot } = useShell();

  return (
    <Screen
      destination="addons"
      lede="An Addon's manifest URL adds it; the Host keeps the Addons and their order."
    >
      {snapshot ? (
        <p className="shell-note" data-testid="addons-summary">
          {snapshot.addons.length === 0
            ? "No Addons are configured yet."
            : `${snapshot.addons.length} ${snapshot.addons.length === 1 ? "Addon is" : "Addons are"} configured.`}
        </p>
      ) : (
        <p className="shell-note">Waiting for the Host…</p>
      )}
    </Screen>
  );
}

function SettingsScreen() {
  const { snapshot } = useShell();

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
