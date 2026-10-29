import { useCallback, useEffect, useRef, type ReactNode } from "react";

import { Rail } from "./Rail";
import type { Destination, ShellLevel } from "./navigation";
import { RepertoryNav } from "./repertory/RepertoryNav";
import { useRepertorySettings } from "./repertory/context";
import { focusAndReveal } from "./reveal";
import { toggleFullscreen, useFullscreen } from "./useFullscreen";
import { useSpatialFocus } from "./useSpatialFocus";
import { WindowChrome } from "./WindowChrome";

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
  /** Which surface draws the frame; the prototype flag chooses repertory (#145). */
  presentation?: "velvet" | "repertory";
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
  presentation = "velvet",
}: ShellFrameProps) {
  const { settings } = useRepertorySettings();
  const repertory = presentation === "repertory";
  const base = useRef<HTMLDivElement | null>(null);
  const levelNodes = useRef(new Map<string, HTMLDivElement>());
  const firstDestination = useRef(true);
  const top = levels[levels.length - 1] ?? null;
  const playerIndex = levels.findIndex((level) => level.kind === "player");
  const takeover = playerIndex >= 0;
  const topIndex = levels.length - 1;
  const { supported } = useFullscreen();

  // F11 belongs to the window, not to the shell's intent table: it works from
  // Home, Settings, a Title, a dialog, and inside the player with the OSD away,
  // and it is no key a screen can consume. One handler for the whole window;
  // a held key is one press. `supported` is the synchronous Tauri check, so the
  // handler binds on the first render — and stays bound when the first read is
  // refused. A plain browser (Vite's dev window, a test) has no window to
  // change and keeps its own F11; the served Remote page is a separate client
  // and never runs this code.
  useEffect(() => {
    if (!supported) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F11" || event.repeat) {
        return;
      }
      event.preventDefault();
      void toggleFullscreen();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [supported]);

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
    onIntent: top?.onIntent,
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
    focusAndReveal(
      // The rail item is the control a destination change means; a screen's own
      // `data-destination` marker is a section, not something focus can land on.
      base.current?.querySelector<HTMLElement>(
        `[data-destination="${destination}"][data-focusable]`,
      ),
    );
  }, [destination]);

  return (
    <div
      className={repertory ? "shell-frame rep-frame" : "shell-frame"}
      data-testid="shell-frame"
      data-ui={repertory ? "repertory" : undefined}
      data-frame={repertory ? settings.frame : undefined}
    >
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
        {repertory ? (
          <RepertoryNav
            variant={settings.frame}
            active={destination}
            onChoose={onChooseDestination}
          />
        ) : (
          <Rail active={destination} onChoose={onChooseDestination} />
        )}
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
        {/* The base's own window control, while it is the surface on top. A
            pushed level draws its own; the player level draws none, because its
            OSD carries the same button over the picture. */}
        {levels.length === 0 ? <WindowChrome /> : null}
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
          {index === topIndex && !takeover ? <WindowChrome /> : null}
        </div>
      ))}
    </div>
  );
}
