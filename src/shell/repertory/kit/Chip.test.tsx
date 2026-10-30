import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { Chip, ChoiceChip } from "./Chip";

describe("the repertory chip", () => {
  test("a static chip is a mark, not a control", () => {
    render(<Chip>Unmapped</Chip>);

    expect(screen.getByText("Unmapped")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  test("a choice chip is a single-select control that announces its selection", () => {
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
    expect(movie).toHaveAttribute("data-focusable");
    expect(movie).toHaveAttribute("aria-pressed", "false");
    expect(series).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(movie);
    expect(onChoose).toHaveBeenCalledOnce();
  });
});
