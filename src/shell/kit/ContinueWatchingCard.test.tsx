import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import { ContinueWatchingCard } from "./ContinueWatchingCard";

describe("the Continue watching card", () => {
  test("draws 16:9 art, the name, where the Video was left and the crimson progress bar", () => {
    render(
      <ContinueWatchingCard
        name="Breaking Bad — S1E1"
        note="42:10 left"
        art="https://images.test/breaking-bad.jpg"
        progress={0.35}
        testId="resume-tt0903747:1:1"
      />,
    );

    const card = screen.getByRole("button", { name: /Breaking Bad/ });
    expect(card).toHaveClass("kit-continue", "kit-focus-lift");
    expect(card).toHaveAttribute("data-focusable");
    expect(card.querySelector('[data-aspect="16:9"]')).not.toBeNull();
    expect(card.querySelector("img")).toHaveAttribute("src", "https://images.test/breaking-bad.jpg");
    expect(screen.getByText("42:10 left")).toHaveClass("kit-tabular");

    const fill = screen.getByTestId("resume-tt0903747:1:1-progress").firstElementChild;
    expect(fill).toHaveStyle({ width: "35%" });
  });

  test("keeps the progress fraction inside the bar", () => {
    render(<ContinueWatchingCard name="Past the end" note="Watched" progress={1.4} />);
    const fill = screen
      .getByRole("button", { name: /Past the end/ })
      .querySelector(".kit-continue-progress > span");
    expect(fill).toHaveStyle({ width: "100%" });
  });

  test("hides the bar when there is no length to measure against", () => {
    render(<ContinueWatchingCard name="Just opened" note="Not started yet" progress={null} />);

    const card = screen.getByRole("button", { name: /Just opened/ });
    expect(card.querySelector(".kit-continue-progress")).toBeNull();
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
    expect(card).toHaveAttribute("data-unplayable", "true");
    expect(card).not.toHaveAttribute("data-focusable");
    expect(card).toBeDisabled();
    expect(screen.getByText(/Unplayable —/)).toHaveClass("kit-continue-note-warn");

    fireEvent.click(card);
    expect(onResume).not.toHaveBeenCalled();
  });
});
