import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { ShellFrame } from "./ShellFrame";
import type { ShellLevel } from "./navigation";
import shellCss from "./shell.css?raw";

afterEach(() => {
  vi.restoreAllMocks();
});

/** One CSS rule's declarations, by its exact selector. */
function declarationsOf(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return shellCss.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

/**
 * jsdom measures every box as zero, so give the frame a screen the D-pad can
 * stand on. An element is found by whichever identity the frame gives it: a
 * test id, the region it declares, or a rail destination's own name.
 */
function layOutShell() {
  const boxes: Record<string, [number, number, number, number]> = {
    shell: [0, 0, 1920, 1080],
    rail: [18, 18, 92, 1044],
    home: [18, 32, 92, 56],
    discover: [18, 94, 92, 56],
    search: [18, 156, 92, 56],
    library: [18, 218, 92, 56],
    addons: [18, 280, 92, 56],
    settings: [18, 342, 92, 56],
    screen: [128, 64, 1792, 1016],
    "row:home": [128, 200, 800, 260],
    opener: [128, 200, 180, 260],
    "window-chrome": [0, 0, 1920, 56],
    "window-fullscreen": [1848, 8, 40, 40],
  };

  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement): DOMRect {
      const key = this.dataset.testid ?? this.dataset.region ?? this.dataset.destination;
      const [x, y, width, height] = (key ? boxes[key] : undefined) ?? [0, 0, 0, 0];
      return {
        x,
        y,
        width,
        height,
        top: y,
        left: x,
        right: x + width,
        bottom: y + height,
        toJSON: () => ({}),
      } as DOMRect;
    },
  );
}

function harness(onBack = vi.fn()) {
  function Harness() {
    const [levels, setLevels] = useState<ShellLevel[]>([]);
    const open = () => {
      setLevels([
        {
          id: "title",
          name: "Title",
          kind: "overlay",
          render: () => (
            <section data-region="title" data-kind="branch" data-label="the title">
              <button data-focusable onClick={() => setLevels([])}>
                Back to browsing
              </button>
            </section>
          ),
        },
      ]);
    };

    return (
      <ShellFrame
        destination="home"
        onChooseDestination={() => {}}
        levels={levels}
        onBack={() => {
          onBack();
          setLevels((held) => held.slice(0, -1));
        }}
        screen={
          <section data-region="row:home" data-kind="row" data-label="Home">
            <button data-focusable data-testid="opener" onClick={open}>
              Open the Title
            </button>
          </section>
        }
      />
    );
  }

  return { onBack, ...render(<Harness />) };
}

function PlayerHarness() {
  const levels: ShellLevel[] = [
    { id: "title", name: "Title", kind: "overlay", render: () => <div>Title</div> },
    { id: "player", name: "Player", kind: "player", render: () => <div>Player</div> },
  ];

  return (
    <ShellFrame
      destination="home"
      onChooseDestination={() => {}}
      levels={levels}
      onBack={() => {}}
      screen={<div>Home</div>}
    />
  );
}

describe("the shell frame", () => {
  test("the player hides the levels it was opened over, because its hole is transparent", () => {
    const { container } = render(<PlayerHarness />);

    const title = container.querySelector('[data-level-id="title"]');
    const player = container.querySelector('[data-level-id="player"]');
    expect(title).toHaveAttribute("data-under-player", "true");
    expect(player).not.toHaveAttribute("data-under-player");
  });

  test("draws the six destinations in order, each with a label", () => {
    harness();
    const rail = screen.getByRole("navigation", { name: "Destinations" });

    expect(
      within(rail)
        .getAllByRole("button")
        .map((button) => button.getAttribute("data-destination")),
    ).toEqual(["home", "discover", "search", "library", "addons", "settings"]);
    expect(within(rail).getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(rail).queryAllByRole("img")).toHaveLength(0);
    expect(rail.querySelectorAll("svg")).toHaveLength(6);
  });

  test("starts focus on the rail's Home entry", async () => {
    harness();

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Home" })),
    );
  });

  test("pushes an overlay over the still-painted screen", async () => {
    const { onBack } = harness();
    const opener = screen.getByRole("button", { name: "Open the Title" });
    opener.focus();
    fireEvent.click(opener);

    const back = await screen.findByRole("button", { name: "Back to browsing" });
    expect(screen.getByText("Open the Title"), "the base is still there").toBeInTheDocument();
    const frame = screen.getByTestId("shell-frame");
    expect(frame.firstElementChild, "the base is out of the tab order under an overlay").toHaveAttribute(
      "inert",
    );
    expect(frame.lastElementChild, "the top level is the one focus belongs to").not.toHaveAttribute(
      "inert",
    );
    expect(frame.lastElementChild).toHaveAttribute("data-level-kind", "overlay");
    await waitFor(() => expect(document.activeElement).toBe(back));
    expect(onBack).not.toHaveBeenCalled();
  });

  test("Back pops the overlay and restores the exact focus underneath", async () => {
    harness();
    const opener = screen.getByRole("button", { name: "Open the Title" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("button", { name: "Back to browsing" });

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => expect(screen.queryByText("Back to browsing")).not.toBeInTheDocument());
    expect(document.activeElement).toBe(opener);
  });

  test("Backspace is Back outside a text field and stays in the field inside one", async () => {
    harness();
    const field = document.createElement("input");
    field.type = "text";
    document.body.appendChild(field);
    field.focus();
    field.value = "matrix";

    fireEvent.keyDown(document, { key: "Backspace" });
    expect(field.value).toBe("matrix");

    field.blur();
    fireEvent.keyDown(document, { key: "Backspace" });
    // There is nothing pushed, so Back is the shell's wall; the point is only
    // that the key was taken as Back rather than typed into nothing.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Home" }));

    field.remove();
  });

  test("the window's fullscreen control rides on the base and every pushed level", async () => {
    const { container } = harness();

    const base = container.querySelector<HTMLElement>(".shell-base");
    expect(base).not.toBeNull();
    const chrome = within(base as HTMLElement).getByTestId("window-chrome");
    expect(chrome, "the strip is its own focus region").toHaveAttribute(
      "data-region",
      "window",
    );
    expect(chrome).toHaveAttribute("data-kind", "row");
    const button = within(chrome).getByRole("button", { name: "Full screen" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveAttribute("data-focusable");
    expect(
      chrome.querySelectorAll("[data-focusable]"),
      "the strip holds the one button, not a control per pixel",
    ).toHaveLength(1);

    fireEvent.click(screen.getByTestId("opener"));
    const level = await waitFor(() => {
      const found = container.querySelector<HTMLElement>('[data-level-id="title"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    expect(within(level).getByTestId("window-chrome")).toBeInTheDocument();
    expect(within(level).getByRole("button", { name: "Full screen" })).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-testid="window-chrome"]'),
      "one control for the level on top, not one per level beneath it",
    ).toHaveLength(1);
  });

  test("the player level takes the window control away: its OSD has its own", () => {
    render(<PlayerHarness />);

    expect(screen.queryByTestId("window-chrome")).not.toBeInTheDocument();
    expect(screen.queryByTestId("window-fullscreen")).not.toBeInTheDocument();
  });

  test("Up from a top-row card lands on the window control, and the rail's top item stops", async () => {
    layOutShell();
    harness();

    const home = screen.getByRole("button", { name: "Home" });
    await waitFor(() => expect(document.activeElement).toBe(home));

    screen.getByTestId("opener").focus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByTestId("window-fullscreen")),
    );

    home.focus();
    fireEvent.keyDown(document, { key: "ArrowUp" });
    expect(document.activeElement, "the rail's top is still a wall").toBe(home);
  });

  test("F11 stays the browser's outside the native window", async () => {
    harness();
    await waitFor(() => expect(document.activeElement).not.toBeNull());

    const event = new KeyboardEvent("keydown", {
      key: "F11",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented, "the Remote's F11 is its browser's").toBe(false);
  });

  test("the strip spans the top edge and leaves the pointer to its button", () => {
    const strip = declarationsOf(".shell-window-chrome");
    expect(strip).toMatch(/position:\s*fixed/);
    expect(strip, "full width: the strip is where Up lands from anywhere along the row").toMatch(
      /left:\s*0/,
    );
    expect(strip).toMatch(/right:\s*0/);
    expect(strip, "a click over the content goes through the strip").toMatch(
      /pointer-events:\s*none/,
    );
    expect(
      declarationsOf(".shell-window-chrome-button"),
      "the button itself still takes a click",
    ).toMatch(/pointer-events:\s*auto/);
  });
});
