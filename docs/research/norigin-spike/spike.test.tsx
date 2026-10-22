import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { setFocus } from "@noriginmedia/norigin-spatial-navigation-core";

import {
  BaseScreen,
  DynamicRow,
  Leaf,
  Player,
  Region,
  SearchBox,
  Stack,
  boot,
  rect,
  type CustomDistance,
} from "./spike";

const activeKey = () => document.activeElement?.getAttribute("data-focus-key") ?? null;

async function focus(key: string) {
  await act(async () => {
    await setFocus(key);
  });
}

async function press(key: string, target: Element | Window = window) {
  fireEvent.keyDown(target, { key });
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  boot();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("base + rail + rows", () => {
  test("moves inside a row, down into the row below, and left into the rail", async () => {
    render(<BaseScreen />);
    await focus("continue:0");

    await press("ArrowRight");
    await waitFor(() => expect(activeKey()).toBe("continue:1"));

    await press("ArrowDown");
    // The window's `covering` rule lands on catalog:1, the card under the
    // origin's middle. Norigin has no covering rule: it enters the row and
    // takes the child closest to the viewport's top-left, catalog:0.
    await waitFor(() => expect(activeKey()).toBe("catalog:0"));

    await press("ArrowLeft");
    await waitFor(() => expect(activeKey()).toBe("rail:home"));
  });

  test("stops at the end of a short row instead of leaking into the wider row below", async () => {
    render(<BaseScreen />);
    await focus("continue:2");

    await press("ArrowRight");
    await act(async () => {
      await Promise.resolve();
    });
    expect(activeKey()).toBe("continue:2");
  });
});

describe("the new direct-first/closest rule (#128)", () => {
  test("the default engine blocks; per-control onArrowPress can jump anywhere", async () => {
    const onRowEnd = vi.fn(() => {
      void setFocus("catalog:1");
    });
    render(<BaseScreen onRowEnd={onRowEnd} />);
    await focus("continue:2");

    await press("ArrowRight");
    expect(onRowEnd).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(activeKey()).toBe("catalog:1"));
  });

  test("nextFocusResolver only sees the direct children of one container", async () => {
    // The resolver on `screen` can return the catalog row, but not a control
    // inside it: focus lands on that row's own memory, not the closest card.
    const resolver = (
      _direction: string,
      _current: string,
      siblings: Array<{ focusKey: string }>,
    ) => siblings.find((sibling) => sibling.focusKey === "row:catalog") as never;

    render(
      <Region focusKey="base" label="base" box={{ x: 0, y: 0, w: 1000, h: 600 }} boundary>
        <Region
          focusKey="screen"
          label="screen"
          box={{ x: 120, y: 0, w: 800, h: 600 }}
          resolver={resolver}
        >
          <Region focusKey="row:continue" label="continue" box={{ x: 120, y: 0, w: 800, h: 100 }}>
            <Leaf focusKey="continue:2" label="continue 2" box={{ x: 360, y: 0, w: 100, h: 100 }} />
          </Region>
          <Region focusKey="row:catalog" label="catalog" box={{ x: 120, y: 120, w: 800, h: 100 }}>
            <Leaf focusKey="catalog:5" label="catalog 5" box={{ x: 720, y: 120, w: 100, h: 100 }} />
            <Leaf focusKey="catalog:1" label="catalog 1" box={{ x: 240, y: 120, w: 100, h: 100 }} />
          </Region>
        </Region>
      </Region>,
    );

    await focus("catalog:5");
    await focus("continue:2");
    await press("ArrowRight");

    // It returned the row and the row restored its own last child (catalog:5),
    // not the closest control (catalog:1).
    expect(activeKey()).toBe("catalog:5");
  });

  test("custom distance can encode direct-first for one parent, but cannot search another region", async () => {
    const flatTree = () => (
      <Region focusKey="flat" label="flat" box={rect(0, 0, 800, 400)}>
        <Leaf focusKey="flat:origin" label="origin" box={rect(0, 0, 100, 100)} />
        <Leaf focusKey="flat:aligned" label="aligned" box={rect(500, 0, 100, 100)} />
        <Leaf focusKey="flat:diagonal" label="diagonal" box={rect(200, 150, 100, 100)} />
      </Region>
    );

    boot();
    const defaultRun = render(flatTree());
    await focus("flat:origin");
    await press("ArrowRight");
    // The default engine prefers the closer diagonal over the aligned control
    // 400 px away: its weighted score is not #128's direct-first.
    expect(activeKey()).toBe("flat:diagonal");

    defaultRun.unmount();
    cleanup();

    const seen: Array<{ x: number; y: number }> = [];
    // The app's direct-first rule, re-encoded in the callback: zero for an
    // overlapping sibling, a prohibitive cost otherwise. For a diagonal
    // candidate this value is the 5x-weighted primary axis, so it wins.
    const directFirst: CustomDistance = (ref, sibling, isVerticalDirection) => {
      seen.push({ x: sibling.a.x, y: sibling.a.y });
      const cross = isVerticalDirection ? "x" : "y";
      const overlap =
        Math.min(ref.b[cross], sibling.b[cross]) - Math.max(ref.a[cross], sibling.a[cross]);
      return overlap > 0 ? 0 : 1_000_000;
    };
    boot({ customDistanceCalculationFunction: directFirst });

    render(flatTree());
    await focus("flat:origin");
    await press("ArrowRight");

    // The same tree now picks the aligned control. The seam *can* express
    // direct-first, but only by reimplementing it from corners in a callback
    // that never receives the candidate's focus key.
    expect(activeKey()).toBe("flat:aligned");
    expect(seen.length).toBeGreaterThan(0);

    cleanup();
    seen.length = 0;
    boot({ customDistanceCalculationFunction: directFirst });

    render(<BaseScreen />);
    await focus("continue:2");
    await press("ArrowRight");

    // #128's cross-region half needs the closest control in the row below
    // (catalog:1 at 240,120). The library only enumerates the current parent's
    // siblings, then climbs; the custom callback is never shown that card.
    expect(activeKey()).toBe("continue:2");
    expect(seen.some((box) => box.x === 240 && box.y === 120)).toBe(false);
  });
});

describe("the level stack", () => {
  test("a pushed level takes focus, and popping returns the exact control", async () => {
    render(<Stack />);
    await focus("continue:2");

    fireEvent.click(screen.getByTestId("push"));
    await waitFor(() => expect(activeKey()).toBe("title:play"));

    fireEvent.click(screen.getByTestId("pop"));
    await waitFor(() => expect(activeKey()).toBe("continue:2"));
  });

  test("a popover over the player returns to the picture", async () => {
    render(
      <>
        <Player />
        <Stack />
      </>,
    );
    // Stack's base is a sibling root; focus the player explicitly.
    await focus("player:picture");
    fireEvent.click(screen.getByTestId("open-popover"));
    await waitFor(() => expect(activeKey()).toBe("popover:one"));

    fireEvent.click(screen.getByTestId("close-popover"));
    await waitFor(() => expect(activeKey()).toBe("player:picture"));
  });
});

describe("the player ladder", () => {
  test("walks picture -> strip -> top -> strip -> picture", async () => {
    render(<Player />);
    await focus("player:picture");

    await press("ArrowUp");
    await waitFor(() => expect(activeKey()).toBe("player:play"));

    await press("ArrowUp");
    await waitFor(() => expect(activeKey()).toBe("player:fullscreen"));

    await press("ArrowRight");
    await waitFor(() => expect(activeKey()).toBe("player:stop"));

    await press("ArrowDown");
    await waitFor(() => expect(activeKey()).toBe("player:play"));

    await press("ArrowDown");
    await waitFor(() => expect(activeKey()).toBe("player:picture"));
  });

  test("a hidden OSD has no strip to land on: the library cannot wake it", async () => {
    render(<Player osd={false} />);
    await focus("player:picture");

    await press("ArrowUp");
    await act(async () => {
      await Promise.resolve();
    });
    expect(activeKey()).toBe("player:picture");
  });
});

describe("dynamic rows and stable keys", () => {
  test("inserting at the head keeps focus on the same item and its neighbours", async () => {
    render(<DynamicRow />);
    await focus("dynamic:b");

    fireEvent.click(screen.getByTestId("insert-x"));
    await waitFor(() => expect(activeKey()).toBe("dynamic:b"));

    await press("ArrowRight");
    await waitFor(() => expect(activeKey()).toBe("dynamic:c"));
  });

  test("removing the focused control lands on the first item, not the control before the gap", async () => {
    render(<DynamicRow />);
    await focus("dynamic:c");

    fireEvent.click(screen.getByTestId("remove-c"));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 350));
    });

    // The window's `rehome` keeps the index and steps back: from c it would
    // land on b. Norigin clears b's lastFocusedChildKey and restores the first.
    expect(activeKey()).toBe("dynamic:a");
  });
});

describe("typing targets and keys the library does not own", () => {
  test("Escape, Backspace and GoBack are not in the key map", async () => {
    render(<BaseScreen />);
    await focus("continue:0");

    await press("Escape");
    await press("Backspace");
    await press("GoBack");
    expect(activeKey()).toBe("continue:0");
  });

  test("Left and Right are not yielded to a text field", async () => {
    render(<SearchBox />);
    await focus("search:input");

    await press("ArrowRight", screen.getByRole("textbox"));
    // The window's keyIntent leaves Left/Right to the caret while typing.
    expect(activeKey()).toBe("search:go");
  });
});

describe("the 24px reveal", () => {
  test("focus is painted with preventScroll and nothing calls scrollIntoView", async () => {
    const focusSpy = vi.spyOn(HTMLElement.prototype, "focus");
    const scrollSpy = vi.fn();
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollSpy,
    });

    render(<BaseScreen />);
    await focus("continue:0");

    expect(focusSpy).toHaveBeenCalledWith({ preventScroll: true });
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});
