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
