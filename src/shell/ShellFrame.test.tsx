import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { ConfirmDialog } from "./kit";
import { ShellFrame } from "./ShellFrame";
import type { ShellLevel } from "./navigation";
import kitCss from "./kit/kit.css?raw";
import shellCss from "./shell.css?raw";
import {
  fakeWindowState,
  installTauriRuntime,
  removeTauriRuntime,
  resetFakeWindow,
} from "./tauriWindow.testing";

vi.mock("@tauri-apps/api/window", async () => {
  const fake = await import("./tauriWindow.testing");
  return { getCurrentWindow: () => fake.fakeTauriWindow };
});

beforeEach(() => {
  resetFakeWindow();
  installTauriRuntime();
});

afterEach(() => {
  removeTauriRuntime();
  vi.restoreAllMocks();
});

/** One CSS rule's declarations, by its exact selector. */
function declarationsOf(selector: string, css = shellCss): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

/** A single CSS length in px, for the two units the shell's contract states. */
function lengthInPx(value: string | undefined): number {
  const match = /^([\d.]+)(rem|px)$/.exec(value?.trim() ?? "");
  if (!match) {
    return Number.NaN;
  }
  return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
}

/**
 * jsdom measures every box as zero, so give the frame a screen the D-pad can
 * stand on. An element is found by whichever identity the frame gives it: a
 * test id, the region it declares, a rail destination's own name, or the words
 * on a button the kit drew.
 *
 * The numbers are the CSS contract at this viewport: the chrome strip is
 * 0..56px, content starts at 64px (`--window-chrome-clearance: 4rem`), and the
 * rail's Home item starts at 32px — inside the strip's band on purpose, which
 * is why Up from it must still stop. The shell frame test pins those values.
 */
function layOutShell(width = 1100, height = 720) {
  const railHeight = height - 36;
  const homeTop = 32;
  const itemStep = 62;
  const contentTop = 64;
  const contentLeft = 128;
  const boxes: Record<string, [number, number, number, number]> = {
    shell: [0, 0, width, height],
    rail: [18, 18, 92, railHeight],
    home: [18, homeTop, 92, 56],
    discover: [18, homeTop + itemStep, 92, 56],
    search: [18, homeTop + itemStep * 2, 92, 56],
    library: [18, homeTop + itemStep * 3, 92, 56],
    addons: [18, homeTop + itemStep * 4, 92, 56],
    settings: [18, homeTop + itemStep * 5, 92, 56],
    screen: [contentLeft, contentTop, width - contentLeft, height - contentTop],
    "row:home": [contentLeft, contentTop, Math.min(800, width - contentLeft - 32), 260],
    opener: [contentLeft, contentTop, 180, 260],
    "window-chrome": [0, 0, width, 56],
    "window-fullscreen": [width - 64, 8, 40, 40],
    // The dialog's answers: below the strip, so Up from the initial one has a
    // real step onto the chrome.
    Cancel: [Math.round(width / 2) - 130, Math.round(height / 2) + 90, 120, 44],
    Remove: [Math.round(width / 2) + 10, Math.round(height / 2) + 90, 120, 44],
  };

  return vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement): DOMRect {
      const key =
        this.dataset.testid ??
        this.dataset.region ??
        this.dataset.destination ??
        this.textContent?.trim();
      const [x, y, widthBy, heightBy] = (key ? boxes[key] : undefined) ?? [0, 0, 0, 0];
      return {
        x,
        y,
        width: widthBy,
        height: heightBy,
        top: y,
        left: x,
        right: x + widthBy,
        bottom: y + heightBy,
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
    const chrome = await within(base as HTMLElement).findByTestId("window-chrome");
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

    expect(await within(level).findByTestId("window-chrome")).toBeInTheDocument();
    expect(within(level).getByRole("button", { name: "Full screen" })).toBeInTheDocument();
    expect(
      container.querySelectorAll('[data-testid="window-chrome"]'),
      "one control for the level on top, not one per level beneath it",
    ).toHaveLength(1);
  });

  test("a confirm dialog keeps the window control, and Up from its first answer reaches it", async () => {
    layOutShell();
    const levels: ShellLevel[] = [
      {
        id: "confirm",
        name: "Remove the Addon",
        kind: "overlay",
        render: () => (
          <ConfirmDialog
            title="Remove Example?"
            confirmLabel="Remove"
            danger
            onConfirm={() => {}}
            onCancel={() => {}}
            testId="confirm-remove"
          />
        ),
      },
    ];
    const { container } = render(
      <ShellFrame
        destination="addons"
        onChooseDestination={() => {}}
        levels={levels}
        onBack={() => {}}
        screen={<div>Addons</div>}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Remove Example?" });
    const chrome = await screen.findByTestId("window-chrome");
    const level = container.querySelector<HTMLElement>('[data-level-id="confirm"]');
    expect(level).not.toBeNull();
    expect(
      level,
      "the chrome is the shell's control in this level, not the player's and not the base's",
    ).toContainElement(chrome);
    expect(
      dialog,
      "it is outside the dialog's own content, not one of the answers",
    ).not.toContainElement(within(chrome).getByTestId("window-fullscreen"));
    expect(
      dialog,
      "the dialog keeps its modal semantics; the chrome is simply outside its accessibility scope",
    ).toHaveAttribute("aria-modal", "true");

    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    fireEvent.keyDown(document, { key: "ArrowUp" });
    await waitFor(() =>
      expect(
        document.activeElement,
        "the D-pad can leave the dialog's answers for the window's way out",
      ).toBe(within(chrome).getByTestId("window-fullscreen")),
    );
  });

  test("a Tauri window whose first read refuses still draws the control and takes F11", async () => {
    fakeWindowState().fail = true;
    harness();

    const chrome = await screen.findByTestId("window-chrome");
    expect(chrome).toBeInTheDocument();

    const event = new KeyboardEvent("keydown", {
      key: "F11",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);
    expect(event.defaultPrevented, "the key is still the window's").toBe(true);
  });

  test("the player level takes the window control away: its OSD has its own", () => {
    render(<PlayerHarness />);

    expect(screen.queryByTestId("window-chrome")).not.toBeInTheDocument();
    expect(screen.queryByTestId("window-fullscreen")).not.toBeInTheDocument();
  });

  test("a plain browser draws no window control: there is no window state to change", async () => {
    removeTauriRuntime();
    harness();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument(),
    );
    expect(
      screen.queryByTestId("window-chrome"),
      "the strip is not in the focus model either",
    ).not.toBeInTheDocument();
  });

  test.each([
    [720, 480],
    [1100, 720],
    [1920, 1080],
  ])(
    "Up from the first row reaches the chrome at %ix%i, and the rail's top item stops",
    async (width, height) => {
      layOutShell(width, height);
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
    },
  );

  test("F11 stays the browser's outside the native window", async () => {
    removeTauriRuntime();
    harness();
    await waitFor(() => expect(document.activeElement).not.toBeNull());

    const event = new KeyboardEvent("keydown", {
      key: "F11",
      bubbles: true,
      cancelable: true,
    });
    window.dispatchEvent(event);

    expect(event.defaultPrevented, "a browser's F11 is its own").toBe(false);
  });

  test("the strip spans the top edge, is the band the geometry measures, and leaves the pointer to its button", () => {
    const strip = declarationsOf(".shell-window-chrome");
    expect(strip).toMatch(/position:\s*fixed/);
    expect(strip, "top: the strip is the window's first band").toMatch(/top:\s*0/);
    expect(strip, "full width: the strip is where Up lands from anywhere along the row").toMatch(
      /left:\s*0/,
    );
    expect(strip).toMatch(/right:\s*0/);
    expect(
      strip,
      "56px: the height `layOutShell` fabricates for the window region and the Windows walkthrough stands on",
    ).toMatch(/height:\s*56px/);
    expect(
      strip,
      "8px above and 8px below the 40px button: the band the D-pad measures",
    ).toMatch(/padding:\s*0\.5rem/);
    expect(
      lengthInPx(strip.match(/padding:\s*([\d.]+(?:rem|px))/)?.[1]),
      "the strip's vertical padding is 8px",
    ).toBe(8);
    expect(strip, "above the dialog scrim, so the way out survives a confirmation").toMatch(
      /z-index:\s*45/,
    );
    expect(
      declarationsOf(".kit-dialog-scrim", kitCss),
      "the scrim the chrome deliberately sits above: change one and the pair must be re-checked",
    ).toMatch(/z-index:\s*40/);
    const rail = declarationsOf(".shell-rail");
    expect(
      rail,
      "the rail starts 18px down, inside the strip's band: its Up must still stop",
    ).toMatch(/top:\s*18px/);
    expect(
      rail,
      "and 14px of padding puts the Home item's top at 32px, inside the band",
    ).toMatch(/padding:\s*14px 8px/);

    const button = declarationsOf(".shell-window-chrome-button");
    expect(button, "the control the 56px band holds is 40px square").toMatch(/width:\s*40px/);
    expect(button).toMatch(/height:\s*40px/);
    expect(button, "the button itself still takes a click").toMatch(/pointer-events:\s*auto/);
    expect(strip, "a click over the content goes through the strip").toMatch(
      /pointer-events:\s*none/,
    );

    const clearance = declarationsOf(":root").match(
      /--window-chrome-clearance:\s*([^;]+)/,
    )?.[1];
    expect(
      clearance?.trim(),
      "4rem: content clears the 56px strip by 8px at every window width",
    ).toBe("4rem");
    expect(lengthInPx(clearance), "4rem is 64px of content top").toBe(64);
    expect(
      declarationsOf(".shell-stage"),
      "the base's first row starts below the strip",
    ).toMatch(/padding:\s*var\(--window-chrome-clearance\)/);
    expect(
      declarationsOf(".shell-level"),
      "a pushed level's first row starts below the strip too",
    ).toMatch(/padding-top:\s*var\(--window-chrome-clearance\)/);
    expect(
      declarationsOf('.shell-level[data-level-kind="player"]'),
      "the player's picture is the whole window: no clearance, no painted band",
    ).toMatch(/padding-top:\s*0/);
  });
});
