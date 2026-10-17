import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Button } from "./Button";
import { Chip, ChoiceChip } from "./Chip";

describe("the kit button", () => {
  test("is a secondary, focusable button by default", () => {
    render(<Button>Play</Button>);

    const button = screen.getByRole("button", { name: "Play" });
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveClass("kit-focus-invert");
    expect(button).toHaveAttribute("data-focusable");
    expect(button).toHaveAttribute("data-variant", "secondary");
  });

  test("takes the primary and ghost variants", () => {
    render(
      <>
        <Button variant="primary">Primary</Button>
        <Button variant="ghost">Ghost</Button>
      </>,
    );

    expect(screen.getByRole("button", { name: "Primary" })).toHaveAttribute(
      "data-variant",
      "primary",
    );
    expect(screen.getByRole("button", { name: "Ghost" })).toHaveAttribute("data-variant", "ghost");
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

  test("takes the destructive treatment and passes the press on", () => {
    const onConfirm = vi.fn();
    render(
      <Button variant="primary" danger onClick={onConfirm}>
        Remove
      </Button>,
    );

    const button = screen.getByRole("button", { name: "Remove" });
    expect(button).toHaveAttribute("data-tone", "danger");
    fireEvent.click(button);
    expect(onConfirm).toHaveBeenCalledOnce();
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

describe("the kit chips", () => {
  test("a static chip carries its tone", () => {
    render(
      <>
        <Chip>Neutral</Chip>
        <Chip tone="warn">Unmapped</Chip>
      </>,
    );

    expect(screen.getByText("Neutral")).not.toHaveAttribute("data-tone");
    expect(screen.getByText("Unmapped")).toHaveAttribute("data-tone", "warn");
  });

  test("a choice chip is a control that announces whether it is selected", () => {
    const onChoose = vi.fn();
    render(
      <>
        <ChoiceChip pressed={false} onClick={onChoose}>
          Movie
        </ChoiceChip>
        <ChoiceChip pressed>Series</ChoiceChip>
      </>,
    );

    const movie = screen.getByRole("button", { name: "Movie" });
    const series = screen.getByRole("button", { name: "Series" });
    expect(movie).toHaveAttribute("aria-pressed", "false");
    expect(series).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(movie);
    expect(onChoose).toHaveBeenCalledOnce();
  });
});
