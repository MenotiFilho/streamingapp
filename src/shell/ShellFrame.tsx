import { AnimatePresence, motion, usePresence } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

import { Rail } from "./Rail";
import type { Destination, ShellLevel } from "./navigation";
import { destinationTransition } from "./repertory/frame";
import { REPERTORY_RULES } from "./repertory/frame";
import { RepertoryNav } from "./repertory/RepertoryNav";
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
  /** Open the whole destination index, where the frame offers a way to it. */
  onOpenDestinations?: () => void;
};

/**
 * One layer of the repertory base. The screen that leaves is inert the moment
 * its cross-fade starts, so the layer beneath never takes a press and the new
 * screen is the only thing the D-pad can reach.
 */
function RepertoryScreenLayer({ children }: { children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  return (
    <motion.div
      className="rep-screen-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={destinationTransition()}
      aria-hidden={present ? undefined : true}
      inert={present ? undefined : true}
      onAnimationComplete={() => {
        if (!present) {
          safeToRemove();
        }
      }}
    >
      {children}
    </motion.div>
  );
}

/**
 * The repertory base cross-fades on a destination switch (design record §6).
 * Both layers share one grid cell, so the old screen fades out under the new
 * one instead of sliding or delaying it: the animation never gates input.
 */
function RepertoryScreenStack({
  destination,
  children,
}: {
  destination: Destination;
  children: ReactNode;
}) {
  return (
    <div
      className="shell-screen rep-screen-stack"
      data-region="screen"
      data-kind="branch"
      data-label="the content"
    >
      <AnimatePresence initial={false}>
        <RepertoryScreenLayer key={destination}>{children}</RepertoryScreenLayer>
      </AnimatePresence>
    </div>
  );
}

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
  onOpenDestinations,
}: ShellFrameProps) {
  const repertory = presentation === "repertory";
  const frame = useRef<HTMLDivElement | null>(null);
  const base = useRef<HTMLDivElement | null>(null);
  const levelNodes = useRef(new Map<string, HTMLDivElement>());
  const firstDestination = useRef(true);
  const top = levels[levels.length - 1] ?? null;
  const playerIndex = levels.findIndex((level) => level.kind === "player");
  const takeover = playerIndex >= 0;
  const topIndex = levels.length - 1;
  /**
   * A Settings leaf is a page beside the programme, not a takeover: the spine
   * stays live and the focus root covers both. Every other level keeps the
   * spine out of the tab order, as the Title and Streams always have.
   */
  const settingsLeaf = repertory && top?.id.startsWith("settings-") === true;
  const navInteractive = repertory && (levels.length === 0 || settingsLeaf);
  const { supported } = useFullscreen();

  // F11 belongs to the window, not to the shell's intent table: it works from
  // Home, Settings, a Title, a dialog, and inside the player with the OSD away,
  // and it is no key a screen can consume. One handler for the whole window;
  // a held key is one press. `supported` is the synchronous fullscreen check, so
  // the handler binds on the first render — and stays bound when the first read
  // is refused. On the Vite dev page the same key asks the browser document for
  // fullscreen; the served Remote page is a separate client and never runs this
  // code.
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
    // The repertory base and its Settings leaves share one root with the
    // spine, so Left reaches the programme index and Right comes back into the
    // page. A Title, Streams list, dialog or player is still the only root.
    if (repertory && (levels.length === 0 || settingsLeaf)) {
      return frame.current;
    }
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
    rules: repertory ? REPERTORY_RULES : undefined,
  });

  // A destination change is a deliberate choice: focus lands on the rail item
  // that was chosen, so the level key's memory holds that item rather than the
  // card the previous screen happened to leave focus on. The first paint is not
  // a choice — the base screen decides where focus starts. A layout effect puts
  // focus on the new repertory level before the cross-fade paints; the Velvet
  // frame keeps the post-paint effect it shipped with.
  const restoreDestinationFocus = useCallback(() => {
    if (firstDestination.current) {
      firstDestination.current = false;
      return;
    }
    focusAndReveal(
      // The rail item is the control a destination change means; a screen's own
      // `data-destination` marker is a section, not something focus can land on.
      // The repertory spine lives beside the base, so it is looked up in the
      // frame; the Velvet rail is still inside the base.
      (repertory ? frame.current : base.current)?.querySelector<HTMLElement>(
        `[data-destination="${destination}"][data-focusable]`,
      ),
    );
  }, [destination, repertory]);

  useLayoutEffect(() => {
    if (repertory) {
      restoreDestinationFocus();
    }
  }, [repertory, restoreDestinationFocus]);

  useEffect(() => {
    if (!repertory) {
      restoreDestinationFocus();
    }
  }, [repertory, restoreDestinationFocus]);

  return (
    <div
      ref={frame}
      className={repertory ? "shell-frame rep-frame" : "shell-frame"}
      data-testid="shell-frame"
      data-ui={repertory ? "repertory" : undefined}
      data-reveal={repertory ? "center" : undefined}
      data-region={repertory ? "frame" : undefined}
      data-kind={repertory ? "branch" : undefined}
      data-label={repertory ? "the window" : undefined}
    >
      {repertory ? (
        <div
          className="shell-nav-slot"
          inert={navInteractive ? undefined : true}
          aria-hidden={navInteractive ? undefined : true}
        >
          <RepertoryNav
            active={destination}
            onChoose={onChooseDestination}
            onOpenDestinations={onOpenDestinations ?? (() => undefined)}
          />
        </div>
      ) : null}
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
        {repertory ? null : (
          <Rail active={destination} onChoose={onChooseDestination} />
        )}
        <main className="shell-stage">
          {repertory ? (
            <RepertoryScreenStack destination={destination}>{screen}</RepertoryScreenStack>
          ) : (
            <div
              className="shell-screen"
              data-region="screen"
              data-kind="branch"
              data-label="the content"
            >
              {screen}
            </div>
          )}
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
