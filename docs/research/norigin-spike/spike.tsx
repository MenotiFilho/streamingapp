/**
 * A representative slice of the streamingapp window on Norigin 3.3.0 / core 4.1.2.
 *
 * It is deliberately a spike: one file, no production imports, and the
 * rectangles come from `data-rect` so jsdom can run it. The shapes are the
 * window's: rail + screen, rows with stable keys, a pushed Title level, a
 * popover over the player, and the player's picture/strip/top ladder.
 */
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  FocusContext,
  useFocusable,
} from "@noriginmedia/norigin-spatial-navigation-react";
import {
  SpatialNavigation,
  getCurrentFocusKey,
  init,
  setFocus,
  type FocusableComponent,
  type NextFocusResolver,
  type SpatialNavigationServiceOptions,
} from "@noriginmedia/norigin-spatial-navigation-core";

export type Rect = { x: number; y: number; w: number; h: number };

export const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

function rectOf(node: Node): Rect {
  const value = (node as HTMLElement).dataset.rect ?? "0,0,0,0";
  const [x, y, w, h] = value.split(",").map(Number);
  return { x: x ?? 0, y: y ?? 0, w: w ?? 0, h: h ?? 0 };
}

/** jsdom lays nothing out; the adapter reads the same rects the test wrote. */
const rectAdapter = {
  measureLayout: async (component: FocusableComponent) => {
    const box = rectOf(component.node);
    return {
      ...box,
      left: box.x,
      top: box.y,
      width: box.w,
      height: box.h,
      right: box.x + box.w,
      bottom: box.y + box.h,
      node: component.node,
    };
  },
};

export type Utter = (text: string) => void;

export type CustomDistance = NonNullable<
  SpatialNavigationServiceOptions["customDistanceCalculationFunction"]
>;

/** A fresh singleton per test: destroy resets keys, handlers and layout. */
export function boot(
  options: {
    onUtterText?: Utter;
    customDistanceCalculationFunction?: CustomDistance;
  } = {},
): void {
  SpatialNavigation.destroy();
  init({
    shouldFocusDOMNode: true,
    domNodeFocusOptions: { preventScroll: true },
    layoutAdapter: rectAdapter,
    debug: true,
    onUtterText: options.onUtterText,
    customDistanceCalculationFunction: options.customDistanceCalculationFunction,
    focusOnPresetKey: false,
  });
}

type ArrowHandler = (direction: string) => boolean | void;

export function Leaf({
  focusKey,
  label,
  box,
  onEnterPress,
  onArrowPress,
}: {
  focusKey: string;
  label: string;
  box: Rect;
  onEnterPress?: () => void;
  onArrowPress?: ArrowHandler;
}) {
  const { ref, focused } = useFocusable({
    focusKey,
    accessibilityLabel: label,
    onEnterPress,
    onArrowPress: (direction) => {
      const answer = onArrowPress?.(direction);
      return answer === false ? false : true;
    },
  });

  return (
    <button
      ref={ref}
      type="button"
      data-focus-key={focusKey}
      data-rect={`${box.x},${box.y},${box.w},${box.h}`}
      data-focused={focused ? "true" : undefined}
      onClick={onEnterPress}
    >
      {label}
    </button>
  );
}

export function Region({
  focusKey,
  label,
  box,
  children,
  boundary = false,
  resolver,
  preferred,
  focusable = true,
  autoRestore = true,
}: {
  focusKey: string;
  label: string;
  box: Rect;
  children: ReactNode;
  boundary?: boolean;
  resolver?: NextFocusResolver;
  preferred?: string;
  focusable?: boolean;
  autoRestore?: boolean;
}) {
  const { ref, focusKey: key } = useFocusable({
    focusKey,
    focusable,
    trackChildren: true,
    saveLastFocusedChild: true,
    autoRestoreFocus: autoRestore,
    isFocusBoundary: boundary,
    focusBoundaryDirections: boundary ? ["up", "down", "left", "right"] : undefined,
    nextFocusResolver: resolver,
    preferredChildFocusKey: preferred,
    accessibilityLabel: label,
  });

  return (
    <section
      ref={ref}
      data-region={focusKey}
      data-rect={`${box.x},${box.y},${box.w},${box.h}`}
      aria-label={label}
    >
      <FocusContext.Provider value={key}>{children}</FocusContext.Provider>
    </section>
  );
}

const RAIL = ["home", "discover", "search", "library", "addons", "settings"] as const;

export function BaseScreen({
  cards = 8,
  onRowEnd,
}: {
  cards?: number;
  onRowEnd?: () => void;
}) {
  return (
    <Region focusKey="base" label="the shell" box={rect(0, 0, 1000, 600)} boundary>
      <Region focusKey="rail" label="the rail" box={rect(0, 0, 100, 600)}>
        {RAIL.map((destination, index) => (
          <Leaf
            key={destination}
            focusKey={`rail:${destination}`}
            label={destination}
            box={rect(0, index * 90, 100, 80)}
          />
        ))}
      </Region>
      <Region focusKey="screen" label="the content" box={rect(120, 0, 800, 600)}>
        <Region focusKey="row:continue" label="Continue watching" box={rect(120, 0, 800, 100)}>
          {Array.from({ length: 3 }, (_, index) => (
            <Leaf
              key={index}
              focusKey={`continue:${index}`}
              label={`continue ${index}`}
              box={rect(120 + index * 120, 0, 100, 100)}
              onArrowPress={index === 2 && onRowEnd ? () => { onRowEnd(); return false; } : undefined}
            />
          ))}
        </Region>
        <Region focusKey="row:catalog" label="Catalog" box={rect(120, 120, 800, 100)}>
          {Array.from({ length: cards }, (_, index) => (
            <Leaf
              key={index}
              focusKey={`catalog:${index}`}
              label={`catalog ${index}`}
              box={rect(120 + index * 120, 120, 100, 100)}
            />
          ))}
        </Region>
      </Region>
    </Region>
  );
}

/**
 * The pushed level and the popover: both are roots beside the base, both stop
 * at their own edge, and focus returns to whatever key was current before.
 */
export function Stack() {
  const [open, setOpen] = useState(false);
  const [popover, setPopover] = useState(false);
  const before = useRef<string | null>(null);
  const beforePopover = useRef<string | null>(null);

  const push = () => {
    before.current = getCurrentFocusKey();
    setOpen(true);
  };

  const pop = () => {
    setOpen(false);
    if (before.current) {
      void setFocus(before.current);
    }
  };

  const openPopover = () => {
    beforePopover.current = getCurrentFocusKey();
    setPopover(true);
  };

  const closePopover = () => {
    setPopover(false);
    if (beforePopover.current) {
      void setFocus(beforePopover.current);
    }
  };

  useEffect(() => {
    if (open) {
      void setFocus("level:title");
    }
  }, [open]);

  useEffect(() => {
    if (popover) {
      void setFocus("popover");
    }
  }, [popover]);

  return (
    <>
      <BaseScreen />
      {open ? (
        <Region
          focusKey="level:title"
          label="the title"
          box={rect(300, 100, 600, 400)}
          boundary
          autoRestore={false}
          preferred="title:play"
        >
          <Leaf focusKey="title:play" label="Play" box={rect(320, 120, 120, 40)} />
          <Leaf focusKey="title:episode" label="Episode" box={rect(320, 180, 120, 40)} />
        </Region>
      ) : null}
      {popover ? (
        <Region focusKey="popover" label="the popover" box={rect(600, 200, 300, 200)} boundary autoRestore={false}>
          <Leaf focusKey="popover:one" label="one" box={rect(620, 220, 100, 40)} />
          <Leaf focusKey="popover:two" label="two" box={rect(620, 280, 100, 40)} />
        </Region>
      ) : null}
      <div>
        <button type="button" data-testid="push" onClick={push}>
          push
        </button>
        <button type="button" data-testid="pop" onClick={pop}>
          pop
        </button>
        <button type="button" data-testid="open-popover" onClick={openPopover}>
          popover
        </button>
        <button type="button" data-testid="close-popover" onClick={closePopover}>
          close popover
        </button>
      </div>
    </>
  );
}

type Stop = "picture" | "strip" | "top";
const STOPS: Record<Stop, string> = {
  picture: "player:picture",
  strip: "player:strip",
  top: "player:top",
};

const LADDER: Record<Stop, { up?: Stop; down?: Stop }> = {
  top: { down: "strip" },
  strip: { up: "top", down: "picture" },
  picture: { up: "strip" },
};

/** The player's own ladder as a resolver: the library never decides Up/Down. */
const ladderResolver: NextFocusResolver = (direction, currentFocusKey, siblings) => {
  const byKey = new Map(siblings.map((sibling) => [sibling.focusKey, sibling]));
  const here =
    currentFocusKey === "player:picture"
      ? "picture"
      : currentFocusKey === "player:top"
        ? "top"
        : "strip";
  const next = LADDER[here][direction as "up" | "down"];
  if (!next) {
    return null;
  }
  return byKey.get(STOPS[next]) ?? null;
};

export function Player({ osd = true }: { osd?: boolean }) {
  return (
    <Region
      focusKey="player"
      label="the player"
      box={rect(0, 0, 1000, 600)}
      boundary
      resolver={ladderResolver}
      preferred="player:picture"
    >
      <Leaf focusKey="player:picture" label="picture" box={rect(0, 0, 1000, 600)} />
      {osd ? (
        <Region focusKey="player:strip" label="the OSD strip" box={rect(0, 500, 1000, 80)}>
          <Leaf focusKey="player:play" label="play" box={rect(100, 510, 60, 40)} />
          <Leaf focusKey="player:chapters" label="chapters" box={rect(200, 510, 60, 40)} />
        </Region>
      ) : null}
      {osd ? (
        <Region focusKey="player:top" label="the window controls" box={rect(800, 20, 180, 40)}>
          <Leaf focusKey="player:fullscreen" label="full screen" box={rect(800, 20, 80, 40)} />
          <Leaf focusKey="player:stop" label="stop" box={rect(890, 20, 80, 40)} />
        </Region>
      ) : null}
    </Region>
  );
}

/** A row whose items can be inserted and removed while it has focus. */
export function DynamicRow() {
  const [items, setItems] = useState(["a", "b", "c", "d"]);
  return (
    <>
      <Region focusKey="row:dynamic" label="Dynamic" box={rect(0, 0, 800, 100)}>
        {items.map((item, index) => (
          <Leaf
            key={item}
            focusKey={`dynamic:${item}`}
            label={item}
            box={rect(index * 120, 0, 100, 100)}
          />
        ))}
      </Region>
      <button type="button" data-testid="remove-b" onClick={() => setItems((held) => held.filter((item) => item !== "b"))}>
        remove b
      </button>
      <button type="button" data-testid="remove-c" onClick={() => setItems((held) => held.filter((item) => item !== "c"))}>
        remove c
      </button>
      <button type="button" data-testid="insert-x" onClick={() => setItems(["x", ...items])}>
        insert x
      </button>
    </>
  );
}

/** The window's text field, to show what the library does with a caret. */
function FocusableInput({ focusKey }: { focusKey: string }) {
  const { ref } = useFocusable({ focusKey, accessibilityLabel: "query" });
  return <input ref={ref} data-rect="0,0,300,40" aria-label="query" />;
}

export function SearchBox() {
  return (
    <Region focusKey="search" label="Search" box={rect(0, 0, 400, 100)}>
      <FocusableInput focusKey="search:input" />
      <Leaf focusKey="search:go" label="go" box={rect(320, 0, 100, 40)} />
    </Region>
  );
}
