import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ConfirmDialog } from "./ConfirmDialog";

describe("the repertory confirmation surface", () => {
  test("is a modal dialog named by its title, and is its own focus region", () => {
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
    expect(
      dialog,
      "the panel is its own focus region, labelled by the question it asks",
    ).toHaveAttribute("data-region", expect.stringMatching(/^dialog:/));
    expect(dialog).toHaveAttribute("data-kind", "dialog");
    expect(dialog).toHaveAttribute("data-label", "Remove Addon");
    expect(within(dialog).getByText(/Cinemeta will no longer/)).toBeInTheDocument();
  });

  test("focuses the safe answer first, and both answers answer", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        title="Remove Addon"
        confirmLabel="Remove"
        danger
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "Remove Addon" });
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveFocus();

    fireEvent.click(cancel);
    expect(onCancel).toHaveBeenCalledOnce();

    const confirm = within(dialog).getByRole("button", { name: "Remove" });
    fireEvent.click(confirm);
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  test("is a one-answer notice when there is nothing to cancel", () => {
    render(<ConfirmDialog title="Pairing code rotated" confirmLabel="Done" onConfirm={() => {}} />);

    const dialog = screen.getByRole("dialog", { name: "Pairing code rotated" });
    expect(within(dialog).queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(within(dialog).getByRole("button", { name: "Done" })).toHaveFocus();
  });

  test("keeps the confirming side pending and busy while the Action is in flight", () => {
    render(
      <ConfirmDialog
        title="Revoke device"
        confirmLabel="Revoke"
        danger
        pending
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );

    const confirm = screen.getByRole("button", { name: "Revoke" });
    expect(confirm).toBeDisabled();
    expect(confirm).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("pending-spinner")).toBeInTheDocument();
  });
});
