import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { PosterCard } from "./PosterCard";

describe("the Poster card", () => {
  test("draws a 2:3 poster frame, the name and a tabular subtitle", () => {
    const { container } = render(
      <PosterCard name="The Matrix" poster="https://images.test/matrix.jpg" subtitle="1999" />,
    );

    const card = screen.getByRole("button", { name: /The Matrix/ });
    expect(card).toHaveClass("kit-poster", "kit-focus-lift");
    expect(card).toHaveAttribute("data-focusable");
    expect(card.querySelector('[data-aspect="2:3"]')).not.toBeNull();
    expect(card.querySelector("img")).toHaveAttribute("src", "https://images.test/matrix.jpg");
    expect(screen.getByText("1999")).toHaveClass("kit-tabular");
    expect(container.querySelector(".kit-badge-unmapped")).toBeNull();
  });

  test("leaves an empty frame rather than a broken image when the poster is absent", () => {
    render(<PosterCard name="Missing Art" poster={null} />);

    const card = screen.getByRole("button", { name: /Missing Art/ });
    expect(card.querySelector("img")).toBeNull();
    expect(card.querySelector(".kit-poster-art-empty")).not.toBeNull();
  });

  test("marks an Unmapped Title with the amber badge and still opens it", () => {
    const onOpen = vi.fn();
    render(<PosterCard name="Obsession" unmapped onClick={onOpen} />);

    expect(screen.getByText("Unmapped")).toHaveClass("kit-badge-unmapped");
    const card = screen.getByRole("button", { name: /Obsession/ });
    expect(card).toHaveAttribute("data-unmapped", "true");

    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  test("a disabled card cannot be opened", () => {
    const onOpen = vi.fn();
    render(<PosterCard name="Unplayable" disabled onClick={onOpen} />);

    const card = screen.getByRole("button", { name: /Unplayable/ });
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
  });
});
