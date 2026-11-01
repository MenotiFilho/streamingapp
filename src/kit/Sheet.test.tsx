import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Sheet } from "./Sheet";

/**
 * The repertory sheet's props contract (ADR-0035 §2).
 *
 * The primitive is a modal bottom plate: it is open or it is not, its heading
 * names it, its close control puts it away, and the panel is one focus region
 * its rows belong to. Nothing here reads the drawing.
 */
describe("the repertory sheet", () => {
  test("draws nothing while it is closed", () => {
    render(
      <Sheet open={false} title="Audio & Subtitles" onClose={() => {}}>
        <p>Rows</p>
      </Sheet>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("is a modal dialog named by its heading, and is its own focus region", () => {
    render(
      <Sheet open title="Audio & Subtitles" onClose={() => {}}>
        <p>Rows</p>
      </Sheet>,
    );

    const sheet = screen.getByRole("dialog", { name: "Audio & Subtitles" });
    expect(sheet).toHaveAttribute("aria-modal", "true");
    expect(
      sheet,
      "the panel is its own focus region, labelled by its heading",
    ).toHaveAttribute("data-region", expect.stringMatching(/^sheet:/));
    expect(within(sheet).getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  test("its close control is a focusable mark that puts the sheet away", () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Chapters" closeLabel="Done" onClose={onClose}>
        <p>Rows</p>
      </Sheet>,
    );

    const close = screen.getByRole("button", { name: "Done" });
    expect(close).toHaveAttribute("data-focusable");
    expect(close).toHaveFocus();

    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledOnce();
  });

});
