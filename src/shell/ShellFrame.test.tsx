import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, test, vi } from "vitest";

import { ShellFrame } from "./ShellFrame";
import type { ShellLevel } from "./navigation";

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
            <button data-focusable onClick={open}>
              Open the Title
            </button>
          </section>
        }
      />
    );
  }

  return { onBack, ...render(<Harness />) };
}

describe("the shell frame", () => {
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
});
