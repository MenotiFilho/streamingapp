/**
 * The six destinations, in the rail's order.
 *
 * A destination is a decision both clients share: the window names them in its
 * rail, and the Remote names them in its own. The stack that puts overlays
 * above them is the window's, and stays there.
 */

/** The six destinations, in the rail's order. */
export const DESTINATIONS = [
  { id: "home", label: "Home" },
  { id: "discover", label: "Discover" },
  { id: "search", label: "Search" },
  { id: "library", label: "Library" },
  { id: "addons", label: "Addons" },
  { id: "settings", label: "Settings" },
] as const;

/** One of the six persistent destinations. */
export type Destination = (typeof DESTINATIONS)[number]["id"];
