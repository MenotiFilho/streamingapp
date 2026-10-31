import type { Destination } from "./destinations";

/** One line of programme copy for each destination, in the house's voice. */
export const DESTINATION_NOTES: Record<Destination, string> = {
  home: "Tonight's feature, what you were watching, and the Catalogs in the Addons' order.",
  discover: "TMDB's page of Discovered Titles, asked for by its own filters.",
  search: "TMDB where a credential is held, the Addons' own catalogs otherwise.",
  library: "The owner's Stremio account. Membership is not built; the room stays open.",
  addons: "Add, reorder, feature and remove the services the programme draws from.",
  settings: "Credentials, playback preferences, and the devices paired to this Host.",
};
