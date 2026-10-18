import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";
import { Popover } from "./Popover";

describe("the confirmation surface", () => {
  test("is a modal dialog named by its title, with both answers", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Remove Addon"
        confirmLabel="Remove"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      >
        Cinemeta will no longer answer Catalogs.
      </ConfirmDialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Remove Addon" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(within(dialog).getByText(/Cinemeta will no longer/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();

    const confirm = within(dialog).getByRole("button", { name: "Remove" });
    expect(confirm).toHaveAttribute("data-tone", "danger");
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test("can be a one-answer notice when there is nothing to cancel", () => {
    render(
      <ConfirmDialog title="Pairing code rotated" confirmLabel="Done" onConfirm={() => {}}>
        The old code no longer pairs a device.
      </ConfirmDialog>,
    );

    const dialog = screen.getByRole("dialog", { name: "Pairing code rotated" });
    expect(within(dialog).getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
  });
});

describe("the popover surface", () => {
  test("is a non-modal dialog named by its label, aligned to its anchor", () => {
    render(
      <Popover label="Subtitles" heading="Subtitles" align="end">
        <button type="button">English</button>
      </Popover>,
    );

    const popover = screen.getByRole("dialog", { name: "Subtitles" });
    expect(popover).toHaveAttribute("data-align", "end");
    expect(popover).not.toHaveAttribute("aria-modal");
    expect(within(popover).getByText("Subtitles")).toBeInTheDocument();
    expect(within(popover).getByRole("button", { name: "English" })).toBeInTheDocument();
  });

  test("aligns to the start of its anchor by default", () => {
    render(<Popover label="Speed">1×</Popover>);
    expect(screen.getByRole("dialog", { name: "Speed" })).toHaveAttribute("data-align", "start");
  });
});
