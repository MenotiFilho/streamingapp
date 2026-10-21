import { describe, expect, test } from "vitest";

import { firstFocusable, focusOf, readLevel, type Measure } from "./layout";

const measure: Measure = (element) => {
  const [x, y, w, h] = (element.getAttribute("data-rect") ?? "0,0,0,0")
    .split(",")
    .map(Number);
  return { x: x ?? 0, y: y ?? 0, w: w ?? 0, h: h ?? 0 };
};

function level(): HTMLElement {
  const root = document.createElement("div");
  root.setAttribute("data-region", "shell");
  root.setAttribute("data-kind", "branch");
  root.setAttribute("data-label", "the shell");
  root.innerHTML = `
    <nav data-region="rail" data-kind="rail" data-label="the rail">
      <button data-focusable data-rect="0,0,90,40">Home</button>
      <button data-focusable data-rect="0,50,90,40">Discover</button>
    </nav>
    <main data-region="screen" data-kind="branch" data-label="the content">
      <section data-region="row:one" data-kind="row" data-label="Row one">
        <button data-focusable data-rect="100,0,100,150">A</button>
        <button data-focusable data-rect="220,0,100,150">B</button>
      </section>
    </main>
  `;
  return root;
}

describe("reading a level's geometry from the DOM", () => {
  test("reads the regions, their parent and children, and the controls in each", () => {
    const { layout, elements } = readLevel(level(), { "row:one": 1 }, measure);

    expect(Object.keys(layout.regions)).toEqual(["shell", "rail", "screen", "row:one"]);
    expect(layout.regions["shell"]).toMatchObject({
      kind: "branch",
      label: "the shell",
      parent: null,
      children: ["rail", "screen"],
    });
    expect(layout.regions["screen"]).toMatchObject({
      parent: "shell",
      children: ["row:one"],
    });
    expect(layout.regions["rail"]).toMatchObject({ kind: "rail", parent: "shell" });
    expect(layout.regions["row:one"]).toMatchObject({
      kind: "row",
      label: "Row one",
      parent: "screen",
      itemRects: [
        { x: 100, y: 0, w: 100, h: 150 },
        { x: 220, y: 0, w: 100, h: 150 },
      ],
    });
    expect(elements["row:one"]?.map((element) => element.textContent)).toEqual(["A", "B"]);
    expect(layout.memory).toEqual({ "row:one": 1 });
  });

  test("finds which control is focused, and the first one to start from", () => {
    const root = level();
    const { elements } = readLevel(root, {}, measure);
    const second = elements["row:one"]?.[1] ?? null;

    expect(focusOf(second, elements)).toEqual({ regionId: "row:one", index: 1 });
    expect(focusOf(null, elements)).toBeNull();
    expect(firstFocusable(root)?.textContent).toBe("Home");
  });

  test("does not offer a disabled control to the focus engine", () => {
    const root = document.createElement("div");
    root.setAttribute("data-region", "row:one");
    root.setAttribute("data-kind", "row");
    root.innerHTML = `
      <button data-focusable disabled>Move up</button>
      <button data-focusable>Move down</button>
    `;

    const { layout, elements } = readLevel(root, {}, measure);
    expect(layout.regions["row:one"]?.itemRects).toHaveLength(1);
    expect(elements["row:one"]?.map((element) => element.textContent)).toEqual(["Move down"]);
    expect(firstFocusable(root)?.textContent).toBe("Move down");
  });
});

describe("pruning the regions that cannot hold focus", () => {
  function rootWith(markup: string): HTMLElement {
    const root = document.createElement("div");
    root.setAttribute("data-region", "level");
    root.setAttribute("data-kind", "branch");
    root.innerHTML = markup;
    return root;
  }

  test("drops a leaf with no focusable controls and rebuilds its parent's children", () => {
    const { layout, elements } = readLevel(
      rootWith(`
        <section data-region="streams" data-kind="branch">
          <button data-focusable data-rect="40,40,120,44">Back</button>
          <section data-region="streams:empty" data-kind="row">
            <p>This Addon answered nothing this Host can play.</p>
          </section>
          <section data-region="streams:full" data-kind="row">
            <button data-focusable data-rect="40,200,900,90">Candidate</button>
          </section>
        </section>
      `),
      { "streams:empty": 2, "streams:full": 1 },
      measure,
    );

    expect(Object.keys(layout.regions)).toEqual(["level", "streams", "streams:full"]);
    expect(layout.regions["streams"]?.children).toEqual(["streams:full"]);
    expect(layout.memory).toEqual({ "streams:full": 1 });
    expect(elements["streams:empty"]).toBeUndefined();
    expect(elements["streams:full"]?.map((element) => element.textContent)).toEqual([
      "Candidate",
    ]);
  });

  test("drops a branch whose only child was pruned", () => {
    const { layout } = readLevel(
      rootWith(`
        <nav data-region="rail" data-kind="rail">
          <button data-focusable data-rect="0,0,90,40">Home</button>
        </nav>
        <section data-region="streams" data-kind="branch">
          <section data-region="streams:empty" data-kind="row">
            <p>This Addon answered nothing this Host can play.</p>
          </section>
        </section>
      `),
      {},
      measure,
    );

    expect(Object.keys(layout.regions)).toEqual(["level", "rail"]);
    expect(layout.regions["level"]?.children).toEqual(["rail"]);
  });

  test("drops a row whose only control is disabled", () => {
    const { layout } = readLevel(
      rootWith(`
        <section data-region="row:disabled" data-kind="row">
          <button data-focusable disabled>Move up</button>
        </section>
        <section data-region="row:live" data-kind="row">
          <button data-focusable>Play</button>
        </section>
      `),
      {},
      measure,
    );

    expect(Object.keys(layout.regions)).toEqual(["level", "row:live"]);
    expect(layout.regions["level"]?.children).toEqual(["row:live"]);
  });
});

describe("measuring unadorned", () => {
  test("marks the root while it reads rects, and clears the mark afterwards", () => {
    const root = level();
    const marked: boolean[] = [];
    const watching: Measure = (element) => {
      marked.push(root.hasAttribute("data-measuring"));
      return measure(element);
    };

    const { layout } = readLevel(root, {}, watching);

    expect(marked.length).toBeGreaterThan(0);
    expect(marked.every(Boolean)).toBe(true);
    expect(root).not.toHaveAttribute("data-measuring");
    expect(layout.regions["row:one"]).toBeDefined();
  });

  test("clears the mark even when a Measure throws", () => {
    const root = level();
    const failing: Measure = () => {
      throw new Error("the page cannot be measured");
    };

    expect(() => readLevel(root, {}, failing)).toThrow("the page cannot be measured");
    expect(root).not.toHaveAttribute("data-measuring");
  });
});
