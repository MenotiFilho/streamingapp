import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Switch } from "./Switch";

describe("the repertory switch", () => {
  test("announces the state it was given and asks for the opposite when pressed", () => {
    const onToggle = vi.fn();
    const { rerender } = render(<Switch on label="Autoplay" onToggle={onToggle} />);

    const control = screen.getByRole("switch", { name: "Autoplay" });
    expect(control).toHaveAttribute("data-focusable");
    expect(control).toHaveAttribute("aria-checked", "true");
    fireEvent.click(control);
    expect(onToggle).toHaveBeenLastCalledWith(false);

    rerender(<Switch on={false} label="Autoplay" onToggle={onToggle} />);
    expect(control).toHaveAttribute("aria-checked", "false");
    fireEvent.click(control);
    expect(onToggle).toHaveBeenLastCalledWith(true);
  });

  test("never flips on its own: the state is the Host's", () => {
    render(<Switch on label="Autoplay" onToggle={() => {}} />);

    const control = screen.getByRole("switch");
    fireEvent.click(control);

    expect(control).toHaveAttribute("aria-checked", "true");
  });

  test("a pending switch takes no second press", () => {
    const onToggle = vi.fn();
    render(<Switch on label="Autoplay" pending onToggle={onToggle} />);

    const control = screen.getByRole("switch");
    expect(control).toBeDisabled();
    expect(control).toHaveAttribute("aria-busy", "true");
    fireEvent.click(control);
    expect(onToggle).not.toHaveBeenCalled();
  });
});
