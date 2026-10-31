import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MotionConfig } from "motion/react";
import { useState } from "react";
import { describe, expect, test } from "vitest";

import { CHROME_CLEARANCE } from "../reveal";
import type { Destination, ShellLevel } from "../navigation";
import { DestinationGrid } from "./DestinationGrid";
import { ShellFrame } from "../ShellFrame";
import repertoryCss from "./repertory.css?raw";

/** One CSS rule's declarations, by its exact selector. */
function declarationsOf(selector: string, css = repertoryCss): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

/** A single CSS length in px, for the one band the window's contract states. */
function lengthInPx(value: string | undefined): number {
  const match = /^([\d.]+)(rem|px)$/.exec(value?.trim() ?? "");
  if (!match) {
    return Number.NaN;
  }
  return Number(match[1]) * (match[2] === "rem" ? 16 : 1);
}

function FrameHarness() {
  const [destination, setDestination] = useState<Destination>("home");
  const [levels, setLevels] = useState<ShellLevel[]>([]);

  const choose = (next: Destination) => {
    setDestination(next);
    setLevels([]);
  };

  const back = () => {
    if (levels.length > 0) {
      setLevels((held) => held.slice(0, -1));
      return;
    }
    setDestination("home");
  };

  const openDestinations = () => {
    setLevels([
      {
        id: "destinations",
        name: "All destinations",
        kind: "overlay",
        render: () => (
          <DestinationGrid
            active={destination}
            onChoose={choose}
            onClose={() => setLevels((held) => held.slice(0, -1))}
          />
        ),
      },
    ]);
  };

  return (
    <ShellFrame
      destination={destination}
      onChooseDestination={choose}
      levels={levels}
      onBack={back}
     
      onOpenDestinations={openDestinations}
      screen={
        <section
          data-testid={`content-${destination}`}
          data-region={`screen:${destination}`}
          data-kind="branch"
          data-label={destination}
        >
          <button data-focusable>Content</button>
        </section>
      }
    />
  );
}

function spine() {
  return screen.getByRole("navigation", { name: "Destinations" });
}

describe("the repertory frame", () => {
  test("draws the six destinations, then the More card that opens the grid", () => {
    render(<FrameHarness />);
    const nav = spine();
    const buttons = within(nav).getAllByRole("button");

    expect(buttons.slice(0, 6).map((button) => button.getAttribute("data-destination"))).toEqual([
      "home",
      "discover",
      "search",
      "library",
      "addons",
      "settings",
    ]);
    expect(buttons[6]).toHaveAccessibleName("More destinations");
    expect(within(nav).getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("is the one frame: no program strip comparison is left", () => {
    render(<FrameHarness />);

    expect(screen.getByTestId("shell-frame")).not.toHaveAttribute("data-frame");
    expect(screen.queryByLabelText("the program strip")).not.toBeInTheDocument();
  });

  test("choosing a destination replaces the base, marks it current, and puts focus on it", async () => {
    render(<FrameHarness />);
    const discover = within(spine()).getByRole("button", { name: "Discover" });

    fireEvent.click(discover);

    expect(await screen.findByTestId("content-discover")).toBeInTheDocument();
    expect(discover).toHaveAttribute("aria-current", "page");
    expect(within(spine()).getByRole("button", { name: "Home" })).not.toHaveAttribute(
      "aria-current",
    );
    await waitFor(() => expect(document.activeElement).toBe(discover));
  });

  test("Back from a destination returns to Home and restores its rail item", async () => {
    render(<FrameHarness />);
    fireEvent.click(within(spine()).getByRole("button", { name: "Settings" }));
    await screen.findByTestId("content-settings");

    fireEvent.keyDown(document, { key: "Escape" });

    expect(await screen.findByTestId("content-home")).toBeInTheDocument();
    const home = within(spine()).getByRole("button", { name: "Home" });
    expect(home).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(document.activeElement).toBe(home));
  });

  test("the More card opens the whole programme grid and Back returns to it", async () => {
    render(<FrameHarness />);
    const all = within(spine()).getByRole("button", { name: "More destinations" });
    fireEvent.click(all);

    const grid = await screen.findByRole("region", { name: "All destinations" });
    expect(
      within(grid)
        .getAllByRole("button")
        .filter((button) => button.hasAttribute("data-destination"))
        .map((button) => button.getAttribute("data-destination")),
    ).toEqual(["home", "discover", "search", "library", "addons", "settings"]);
    expect(within(grid).getByRole("button", { name: /Home/ })).toHaveAttribute(
      "aria-current",
      "page",
    );

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "All destinations" })).not.toBeInTheDocument(),
    );
    await waitFor(() => expect(document.activeElement).toBe(all));
  });

  test("choosing a room in the grid closes it and lands on that spine item", async () => {
    render(<FrameHarness />);
    fireEvent.click(within(spine()).getByRole("button", { name: "More destinations" }));
    const grid = await screen.findByRole("region", { name: "All destinations" });

    fireEvent.click(within(grid).getByRole("button", { name: /Library/ }));

    expect(await screen.findByTestId("content-library")).toBeInTheDocument();
    const library = within(spine()).getByRole("button", { name: "Library" });
    expect(library).toHaveAttribute("aria-current", "page");
    await waitFor(() => expect(document.activeElement).toBe(library));
  });

  test("a bare focus does not open the spine; hover and an arrow walk do", async () => {
    render(<FrameHarness />);
    const nav = spine();
    const home = within(nav).getByRole("button", { name: "Home" });

    act(() => home.focus());
    await waitFor(() =>
      expect(nav, "focus alone leaves the compact frame").not.toHaveAttribute("data-open"),
    );

    fireEvent.mouseEnter(nav);
    await waitFor(() => expect(nav).toHaveAttribute("data-open", "true"));

    fireEvent.mouseLeave(nav);
    await waitFor(() => expect(nav).not.toHaveAttribute("data-open"));

    fireEvent.keyDown(home, { key: "ArrowDown" });
    await waitFor(() => expect(nav, "a keyboard walk reveals the labels").toHaveAttribute(
      "data-open",
      "true",
    ));

    act(() => within(nav).getByRole("button", { name: "Discover" }).focus());
    act(() => screen.getByRole("button", { name: "Content" }).focus());
    await waitFor(() =>
      expect(nav, "leaving the spine closes it").not.toHaveAttribute("data-open"),
    );
  });

  test("hover opens the spine, and a press still chooses the destination", async () => {
    render(<FrameHarness />);
    const nav = spine();
    const discover = within(nav).getByRole("button", { name: "Discover" });

    fireEvent.mouseEnter(nav);
    expect(nav, "the pointer reveals the labels on hover").toHaveAttribute(
      "data-open",
      "true",
    );

    fireEvent.pointerDown(discover);
    fireEvent.click(discover);

    expect(await screen.findByTestId("content-discover")).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(discover));

    fireEvent.mouseLeave(nav);
    await waitFor(() =>
      expect(nav, "leaving the spine returns it to the compact frame").not.toHaveAttribute(
        "data-open",
      ),
    );
  });
});

/**
 * A base with one button that pushes an overlay, for the motion's final state:
 * the frame's own tests press a card and read where focus went, and this one
 * reads what the level settles at.
 */
function PushHarness() {
  const [levels, setLevels] = useState<ShellLevel[]>([]);

  return (
    <ShellFrame
      destination="home"
      onChooseDestination={() => {}}
      levels={levels}
      onBack={() => setLevels([])}
     
      screen={
        <button
          data-focusable
          onClick={() =>
            setLevels([
              {
                id: "pushed",
                name: "Pushed",
                kind: "overlay",
                render: () => <p>Inside</p>,
              },
            ])
          }
        >
          Open
        </button>
      }
    />
  );
}

/**
 * A base that pushes a browsing level and then the player over it, for the
 * frozen contract that the player takes the window (ADR-0003): the level under
 * it stays mounted for Back, but paints nothing over mpv's picture.
 */
function PlayerHarness() {
  const [levels, setLevels] = useState<ShellLevel[]>([]);

  return (
    <ShellFrame
      destination="home"
      onChooseDestination={() => {}}
      levels={levels}
      onBack={() => setLevels([])}
     
      screen={
        <button
          data-focusable
          onClick={() =>
            setLevels([
              {
                id: "selection",
                name: "Selection",
                kind: "overlay",
                render: () => <p>Selection</p>,
              },
              {
                id: "player",
                name: "Playing",
                kind: "player",
                render: () => <p>Player</p>,
              },
            ])
          }
        >
          Open
        </button>
      }
    />
  );
}

describe("the player's takeover", () => {
  test("the level under the player stays mounted and paints nothing", async () => {
    render(<PlayerHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));

    const selection = await screen.findByText("Selection");
    const level = selection.closest(".shell-level");
    if (!(level instanceof HTMLElement)) {
      throw new Error("the browsing level did not mount");
    }

    await waitFor(() => expect(level.style.opacity).toBe("0"));
    expect(level).toHaveAttribute("data-under-player", "true");
    expect(level).toHaveAttribute("aria-hidden", "true");
  });
});

describe("a pushed level's motion", () => {
  test("under reduced motion it arrives with the fade and no movement", async () => {
    render(
      <MotionConfig reducedMotion="always">
        <PushHarness />
      </MotionConfig>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const inside = await screen.findByText("Inside");
    const level = inside.closest(".shell-level");
    if (!(level instanceof HTMLElement)) {
      throw new Error("the pushed level did not mount");
    }

    await waitFor(() => expect(level.style.opacity).toBe("1"));
    expect(level.style.transform).not.toContain("translateX");
  });
});

/**
 * The second presentation lock (ADR-0032, docs/agents/testing.md): the
 * frameless chrome's band and pointer promise, asserted against the repertory
 * sheet. The Velvet lock in `ShellFrame.test.tsx` stays as it was.
 */
describe("the repertory window chrome lock", () => {
  test("the strip's band is the band the D-pad geometry measures", () => {
    const root = repertoryCss.match(/\.rep-frame\s*\{[^}]*--window-chrome-height[^}]*\}/)?.[0] ?? "";
    const strip = declarationsOf(".rep-frame .shell-window-chrome");

    expect(strip, "top: the strip is the window's first band").toMatch(/top:\s*0/);
    expect(strip, "full width: Up lands anywhere along the row").toMatch(/left:\s*0/);
    expect(strip).toMatch(/right:\s*0/);
    expect(strip, "the band is the layout's own height token").toMatch(
      /height:\s*var\(--window-chrome-height\)/,
    );
    expect(strip, "8px above and 8px below the 40px button").toMatch(/padding:\s*0\.5rem/);
    expect(root, "the repertory sheet keeps the 56px band").toMatch(
      /--window-chrome-height:\s*56px/,
    );
    expect(
      lengthInPx(root.match(/--window-chrome-height:\s*([^;]+)/)?.[1]),
      "56px is the box the geometry fixture measures",
    ).toBe(56);
    expect(root, "content clears the strip by 8px at 4rem").toMatch(
      /--window-chrome-clearance:\s*4rem/,
    );
    expect(
      lengthInPx(root.match(/--window-chrome-clearance:\s*([^;]+)/)?.[1]),
      "the reveal's chrome inset is this same clearance",
    ).toBe(CHROME_CLEARANCE);
  });

  test("the strip leaves the pointer to its button", () => {
    const strip = declarationsOf(".rep-frame .shell-window-chrome");
    const button = declarationsOf(".rep-frame .shell-window-chrome-button");

    expect(strip, "a click over the content goes through the strip").toMatch(
      /pointer-events:\s*none/,
    );
    expect(button, "the button itself still takes a click").toMatch(
      /pointer-events:\s*auto/,
    );
  });
});
