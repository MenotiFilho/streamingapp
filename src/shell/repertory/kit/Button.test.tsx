import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Button } from "./Button";

describe("the repertory button", () => {
  test("is a button that carries the focus engine's mark", () => {
    render(<Button>Play</Button>);

    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("data-focusable");
  });

  test("announces a toggle state, including the unselected one", () => {
    render(
      <>
        <Button pressed={false}>Unselected</Button>
        <Button pressed>Selected</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Unselected" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Selected" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("passes an ordinary press on", () => {
    const onPress = vi.fn();
    render(<Button onClick={onPress}>Sign in</Button>);

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(onPress).toHaveBeenCalledOnce();
  });

  test("a pending button is disabled, announces the wait and draws the spinner", () => {
    const onPress = vi.fn();
    render(
      <Button pending onClick={onPress}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(screen.getByTestId("pending-spinner")).toBeInTheDocument();

    fireEvent.click(button);
    expect(onPress).not.toHaveBeenCalled();
  });

  test("a disabled button cannot be pressed", () => {
    const onPress = vi.fn();
    render(
      <Button disabled onClick={onPress}>
        Unavailable
      </Button>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Unavailable" }));
    expect(onPress).not.toHaveBeenCalled();
  });
});
