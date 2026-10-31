import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ContinueWatchingCard } from "./ContinueWatchingCard";

describe("the repertory Continue watching card", () => {
  test("resumes the Title and announces how far through it is", () => {
    const onResume = vi.fn();
    render(
      <ContinueWatchingCard
        name="Breaking Bad — S1E1"
        note="42:10 left"
        art="https://images.test/breaking-bad.jpg"
        progress={0.35}
        onClick={onResume}
      />,
    );

    const card = screen.getByRole("button", { name: /Breaking Bad/ });
    expect(card).toHaveAttribute("data-focusable");
    expect(screen.getByText("42:10 left")).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "35");

    fireEvent.click(card);
    expect(onResume).toHaveBeenCalledOnce();
  });

  test("keeps the progress fraction inside the bar", () => {
    render(<ContinueWatchingCard name="Past the end" note="Watched" progress={1.4} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  test("clamps a negative fraction to the start", () => {
    render(<ContinueWatchingCard name="Before the start" note="Not started yet" progress={-0.4} />);

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });

  test("hides the bar when there is no length to measure against", () => {
    render(<ContinueWatchingCard name="Just opened" note="Not started yet" progress={null} />);

    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  test("marks an entry whose Addon is gone, and makes it a card a person cannot press", () => {
    const onResume = vi.fn();
    render(
      <ContinueWatchingCard
        name="Primetime"
        note="Unplayable — the Addon com.stremboxd.popular that supplied this Title is gone."
        progress={0.22}
        unplayable
        onClick={onResume}
      />,
    );

    const card = screen.getByRole("button", { name: /Primetime/ });
    expect(card).not.toHaveAttribute("data-focusable");
    expect(card).toBeDisabled();
    expect(screen.getByText("Unplayable")).toBeInTheDocument();

    fireEvent.click(card);
    expect(onResume).not.toHaveBeenCalled();
  });
});
