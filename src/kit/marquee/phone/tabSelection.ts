import { DESTINATIONS, type Destination } from "../../../core/destinations";
import type { IconName } from "../icons";

/** The glyph each destination is drawn with (`docs/design-system.md` §7). */
export const TAB_ICONS: Record<Destination, IconName> = {
  home: "house",
  discover: "compass",
  search: "search",
  library: "library",
  addons: "puzzle",
  settings: "settings",
};

export type Tab = {
  id: Destination;
  label: string;
  icon: IconName;
  active: boolean;
};

/**
 * The bottom index: the six destinations in the core's order, with the one the
 * person is in marked. Remote devices is a Settings leaf, not a seventh.
 */
export function tabItems(active: Destination): Tab[] {
  return DESTINATIONS.map(({ id, label }) => ({
    id,
    label,
    icon: TAB_ICONS[id],
    active: id === active,
  }));
}
