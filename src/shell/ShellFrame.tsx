import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { Rail } from "./Rail";
import type { Destination, ShellLevel } from "./navigation";
import { useSpatialFocus } from "./useSpatialFocus";

export type ShellFrameProps = {
  /** The base screen a person chose from the rail. */
  destination: Destination;
  onChooseDestination: (destination: Destination) => void;
  /** The base screen's contents: Home, Discover, Search, and so on. */
  screen: ReactNode;
  /** Pushed overlays, outermost first. The last one is on top. */
  levels: readonly ShellLevel[];
  /** What Back means once the top level has had its own chance to answer. */
  onBack: () => void;
};

/**
 * The ten-foot frame: one persistent rail, a base screen beside it, and any
 * number of levels stacked above.
 *
 * Focus belongs to the level on top. A pushed overlay paints over the base
 * without unmounting it, so the level underneath keeps its exact focus; Back
 * pops the overlay and that focus comes back. The player is a level like any
 * other, which is why stopping it returns to the browsing stack that was
 * underneath rather than to Home.
 */
export function ShellFrame({
  destination,
  onChooseDestination,
  screen,
  levels,
  onBack,
}: ShellFrameProps) {
  const base = useRef<HTMLDivElement | null>(null);
  const levelNodes = useRef(new Map<string, HTMLDivElement>());
  const firstDestination = useRef(true);
  const top = levels[levels.length - 1] ?? null;
  const playerIndex = levels.findIndex((level) => level.kind === "player");
  const takeover = playerIndex >= 0;
  const topIndex = levels.length - 1;

  // A stable ref callback: React only detaches a callback ref when its identity
  // changes, so the level nodes stay in the map across ordinary renders.
  const attachLevel = useCallback((node: HTMLDivElement | null) => {
    const id = node?.dataset.levelId;
    if (id && node) {
      levelNodes.current.set(id, node);
    }
  }, []);

  const activeRoot = () => {
    const level = levels[levels.length - 1];
    if (level) {
      return levelNodes.current.get(level.id) ?? null;
    }
    return base.current;
  };

  useSpatialFocus({
    root: activeRoot,
    levelKey: top ? `level:${top.id}` : `base:${destination}`,
    onBack,
  });

  // A destination change is a deliberate choice: focus lands on the rail item
  // that was chosen, so the level key's memory holds that item rather than the
  // card the previous screen happened to leave focus on. The first paint is not
  // a choice — the base screen decides where focus starts.
  useEffect(() => {
    if (firstDestination.current) {
      firstDestination.current = false;
      return;
    }
    base.current
      ?.querySelector<HTMLElement>(`[data-destination="${destination}"]`)
      ?.focus({ preventScroll: true });
  }, [destination]);

  return (
    <div className="shell-frame" data-testid="shell-frame">
      <div
        ref={base}
        className="shell-base"
        data-region="shell"
        data-kind="branch"
        data-label="the shell"
        data-takeover={takeover ? "true" : undefined}
        aria-hidden={levels.length > 0 ? true : undefined}
        inert={levels.length > 0 ? true : undefined}
      >
        <Rail active={destination} onChoose={onChooseDestination} />
        <main className="shell-stage">
          <div
            className="shell-screen"
            data-region="screen"
            data-kind="branch"
            data-label="the content"
          >
            {screen}
          </div>
        </main>
      </div>

      {levels.map((level, index) => (
        <div
          key={level.id}
          ref={attachLevel}
          className="shell-level"
          data-level-id={level.id}
          data-level={level.name}
          data-level-kind={level.kind}
          data-under-player={playerIndex >= 0 && index < playerIndex ? "true" : undefined}
          data-region={`level:${level.id}`}
          data-kind="branch"
          data-label={level.name}
          aria-hidden={index < topIndex ? true : undefined}
          inert={index < topIndex ? true : undefined}
        >
          {level.render()}
        </div>
      ))}
    </div>
  );
}
