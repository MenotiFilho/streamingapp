import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { PosterCard } from "./PosterCard";

describe("the repertory poster card", () => {
  test("opens the Title it draws", () => {
    const onOpen = vi.fn();
    render(
      <PosterCard
        name="The Matrix"
        poster="https://images.test/matrix.jpg"
        subtitle="1999"
        onClick={onOpen}
      />,
    );

    const card = screen.getByRole("button", { name: /The Matrix/ });
    expect(card).toHaveAttribute("data-focusable");

    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  test("stamps the rating over the art only when the Host has one", () => {
    const { rerender } = render(<PosterCard name="The Matrix" rating="8.7" />);
    expect(screen.getByText("IMDb 8.7")).toBeInTheDocument();

    rerender(<PosterCard name="The Matrix" />);
    expect(screen.queryByText(/IMDb/)).toBeNull();
  });

  test("does not draw the description: the record gives the caption the Title alone", () => {
    render(<PosterCard name="Carrie" description="Carrie.S01E01.1080p.WEB-DL.x264-GROUP.mkv" />);

    expect(screen.queryByText(/Carrie\.S01E01/)).toBeNull();
  });

  test("marks an Unmapped Title and still opens it", () => {
    const onOpen = vi.fn();
    render(<PosterCard name="Obsession" unmapped onClick={onOpen} />);

    expect(screen.getByText("Unmapped")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Obsession/ }));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  test("marks an Unplayable Title and still opens it: the mark is not a hiding", () => {
    const onOpen = vi.fn();
    render(<PosterCard name="Primetime" unplayable onClick={onOpen} />);

    expect(screen.getByText("Unplayable")).toBeInTheDocument();
    const card = screen.getByRole("button", { name: /Primetime/ });
    expect(card).toBeEnabled();

    fireEvent.click(card);
    expect(onOpen).toHaveBeenCalledOnce();
  });

  test("a disabled card cannot be opened", () => {
    const onOpen = vi.fn();
    render(<PosterCard name="Unavailable" disabled onClick={onOpen} />);

    const card = screen.getByRole("button", { name: /Unavailable/ });
    expect(card).toBeDisabled();
    fireEvent.click(card);
    expect(onOpen).not.toHaveBeenCalled();
  });

  test("stamps the account's Continue mark, and only when it is asked", () => {
    const { rerender } = render(<PosterCard name="The Matrix" continueWatching />);
    expect(screen.getByText("Continue")).toBeInTheDocument();

    rerender(<PosterCard name="The Matrix" />);
    expect(screen.queryByText("Continue")).toBeNull();
  });

  test("a still card keeps the picture and the marks but is not a control", () => {
    render(
      <PosterCard
        name="The Matrix"
        unplayable
        openable={false}
        testId="library-card-tt0133093"
      />,
    );

    expect(screen.queryByRole("button", { name: /The Matrix/ })).toBeNull();
    expect(screen.getByTestId("library-card-tt0133093")).toBeInTheDocument();
    expect(screen.getByText("Unplayable")).toBeInTheDocument();
  });
});
