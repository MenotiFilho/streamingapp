import type { Destination } from "../../core/destinations";
import { TabItem } from "./TabItem";
import { tabItems } from "./tabSelection";

export type TabBarProps = {
  active: Destination;
  /** A tab was pressed, the one in view included: what that means is the client's. */
  onSelect: (destination: Destination) => void;
  /**
   * Draw the home indicator. A phone draws its own, so this is only for a still
   * of the sheet.
   */
  homeIndicator?: boolean;
};

/**
 * The bottom index (sheet `C8`, "Tab bar"): six destinations over the
 * home-indicator safe area.
 */
export function TabBar({ active, onSelect, homeIndicator = false }: TabBarProps) {
  return (
    <nav className="mq-ph-tab-bar" aria-label="Destinations">
      {tabItems(active).map((tab) => (
        <TabItem
          key={tab.id}
          icon={tab.icon}
          label={tab.label}
          active={tab.active}
          onPress={() => onSelect(tab.id)}
        />
      ))}
      {homeIndicator ? <span className="mq-ph-home-indicator" aria-hidden="true" /> : null}
    </nav>
  );
}
