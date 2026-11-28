import { AnimatePresence, motion, usePresence } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  type ReactNode,
} from "react";

import type { Intent } from "../../core/input";
import { useReducedMotion } from "../../core/react/useReducedMotion";
import { fade, panel } from "../../kit/motion";
import { firstFocusable } from "../layout";
import type { Destination, ShellLevel } from "../navigation";
import { focusAndReveal } from "../reveal";
import { toggleFullscreen, useFullscreen } from "../useFullscreen";
import { useSpatialFocus } from "../useSpatialFocus";
import { WindowChrome } from "../WindowChrome";
import {
  LEVEL_PUSH_PX,
  MARQUEE_RULES,
  POPOVER_RISE_PX,
  destinationTransition,
  isSettingsLeaf,
  levelPushed,
  levelRises,
} from "./frame";
import { MarqueeNav } from "./MarqueeNav";

export type MarqueeFrameProps = {
  destination: Destination;
  onChooseDestination: (destination: Destination) => void;
  screen: ReactNode;
  levels: readonly ShellLevel[];
  onBack: () => void;
  onBaseIntent?: (intent: Intent) => boolean;
  dock?: ReactNode;
};

function MarqueeScreenLayer({ children }: { children: ReactNode }) {
  const [present, safeToRemove] = usePresence();
  return (
    <motion.div
      className="mq-screen-layer"
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

function MarqueeScreenStack({
  destination,
  children,
}: {
  destination: Destination;
  children: ReactNode;
}) {
  return (
    <div
      className="mq-screen-stack"
      data-region="screen"
      data-kind="branch"
      data-label="the content"
    >
      <AnimatePresence initial={false}>
        <MarqueeScreenLayer key={destination}>{children}</MarqueeScreenLayer>
      </AnimatePresence>
    </div>
  );
}

function MarqueeLevelShell({
  level,
  hidden,
  underPlayer,
  chrome,
  attach,
}: {
  level: ShellLevel;
  hidden: boolean;
  underPlayer: boolean;
  chrome: boolean;
  attach: (node: HTMLDivElement | null) => void;
}) {
  const [present, safeToRemove] = usePresence();
  const reducedMotion = useReducedMotion();
  const pushed = levelPushed(level.kind);
  const rises = levelRises(level.kind);
  const node = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (element: HTMLDivElement | null) => {
      node.current = element;
      attach(element);
    },
    [attach],
  );

  useEffect(() => {
    if (present) {
      return;
    }
    const active = document.activeElement;
    if (active instanceof HTMLElement && node.current?.contains(active)) {
      active.blur();
    }
  }, [present]);

  return (
    <motion.div
      ref={setRef}
      className="mq-level-shell"
      data-level-id={level.id}
      data-level={level.name}
      data-level-kind={level.kind}
      data-under-player={underPlayer ? "true" : undefined}
      data-region={`level:${level.id}`}
      data-kind="branch"
      data-label={level.name}
      aria-hidden={!present || hidden ? true : undefined}
      inert={!present || hidden ? true : undefined}
      initial={
        reducedMotion
          ? { opacity: 0 }
          : pushed
            ? { opacity: 0, x: LEVEL_PUSH_PX }
            : rises
              ? { opacity: 0, y: POPOVER_RISE_PX }
              : false
      }
      animate={
        underPlayer
          ? { opacity: 0 }
          : reducedMotion
            ? { opacity: 1 }
            : pushed
              ? { opacity: 1, x: 0 }
              : rises
                ? { opacity: 1, y: 0 }
                : undefined
      }
      exit={
        reducedMotion
          ? { opacity: 0 }
          : pushed
            ? { opacity: 0, x: LEVEL_PUSH_PX }
            : rises
              ? { opacity: 0, y: POPOVER_RISE_PX }
              : { opacity: 0 }
      }
      transition={
        underPlayer
          ? { duration: 0 }
          : pushed || rises
            ? reducedMotion
              ? fade()
              : panel()
            : { duration: 0 }
      }
      onAnimationComplete={() => {
        if (!present) {
          safeToRemove();
        }
      }}
    >
      {level.payload.render()}
      {chrome && present ? <WindowChrome /> : null}
    </motion.div>
  );
}

/**
 * The Marquee window frame: the collapsible side rail, the base screen beside
 * it, any pushed overlay levels stacked above, and the WindowChrome top band.
 */
export function MarqueeFrame({
  destination,
  onChooseDestination,
  screen,
  levels,
  onBack,
  onBaseIntent,
  dock = null,
}: MarqueeFrameProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const base = useRef<HTMLDivElement | null>(null);
  const levelNodes = useRef(new Map<string, HTMLDivElement>());
  const firstDestination = useRef(true);
  const top = levels[levels.length - 1] ?? null;
  const playerIndex = levels.findIndex((level) => level.kind === "player");
  const takeover = playerIndex >= 0;
  const topIndex = levels.length - 1;
  const docked = Boolean(dock);
  const settingsLeaf = isSettingsLeaf(top);
  const navInteractive = levels.length === 0 || settingsLeaf;
  const { supported } = useFullscreen();

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

  const attachLevel = useCallback((node: HTMLDivElement | null) => {
    const id = node?.dataset.levelId;
    if (id && node) {
      levelNodes.current.set(id, node);
    }
  }, []);

  const activeRoot = () => {
    if (levels.length === 0 || settingsLeaf || docked) {
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
    levelKey: `${top ? `level:${top.id}` : `base:${destination}`}${docked ? ":dock" : ""}`,
    onBack,
    onIntent: top?.payload.onIntent ?? onBaseIntent,
    rules: levels.length === 0 || settingsLeaf ? MARQUEE_RULES : undefined,
  });

  const restoreDestinationFocus = useCallback(() => {
    if (firstDestination.current) {
      firstDestination.current = false;
      return;
    }
    focusAndReveal(
      frame.current?.querySelector<HTMLElement>(
        `[data-destination="${destination}"][data-focusable]`,
      ),
    );
  }, [destination]);

  useLayoutEffect(() => {
    restoreDestinationFocus();
  }, [restoreDestinationFocus]);

  const previousDocked = useRef(false);
  const previousTop = useRef<string | null>(null);
  useLayoutEffect(() => {
    const id = top?.id ?? null;
    const arrived =
      docked && id !== null && (!previousDocked.current || id !== previousTop.current);
    previousDocked.current = docked;
    previousTop.current = id;
    if (!arrived) {
      return;
    }
    const node = levelNodes.current.get(id);
    const active = document.activeElement;
    if (!node || (active instanceof HTMLElement && node.contains(active))) {
      return;
    }
    focusAndReveal(firstFocusable(node));
  }, [docked, top?.id]);

  return (
    <div
      ref={frame}
      className="mq-frame"
      data-testid="shell-frame"
      data-reveal="center"
      data-region="frame"
      data-kind="branch"
      data-label="the window"
    >
      <div
        className="mq-nav-slot"
        inert={navInteractive ? undefined : true}
        aria-hidden={navInteractive ? undefined : true}
      >
        <MarqueeNav active={destination} onChoose={onChooseDestination} />
      </div>

      <div
        ref={base}
        className="mq-base"
        data-region="shell"
        data-kind="branch"
        data-label="the shell"
        data-takeover={takeover ? "true" : undefined}
        aria-hidden={levels.length > 0 ? true : undefined}
        inert={levels.length > 0 ? true : undefined}
      >
        <main className="mq-stage">
          <MarqueeScreenStack destination={destination}>{screen}</MarqueeScreenStack>
        </main>
        {levels.length === 0 ? <WindowChrome /> : null}
      </div>

      <AnimatePresence initial={false}>
        {levels.map((level, index) => (
          <MarqueeLevelShell
            key={level.id}
            level={level}
            hidden={index < topIndex}
            underPlayer={playerIndex >= 0 && index < playerIndex}
            chrome={index === topIndex && !takeover}
            attach={attachLevel}
          />
        ))}
      </AnimatePresence>

      {dock}
    </div>
  );
}
