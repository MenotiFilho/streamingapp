import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PosterCard } from "./PosterCard";
import { RowTrack } from "./RowTrack";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Ask the window for reduced motion so a page jump settles synchronously. */
function reduceMotion() {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: true,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

describe("the repertory row track", () => {
  test("heads the track with the programme index, the name, the tag and the action", () => {
    render(
      <RowTrack
        title="Popular Movies"
        index="01"
        tag="com.linvo.cinemeta"
        action={<button type="button">More</button>}
        testId="row-popular"
      >
        <PosterCard name="The Matrix" />
        <PosterCard name="Backrooms" />
      </RowTrack>,
    );

    const region = screen.getByRole("region", { name: "Popular Movies" });
    expect(within(region).getByText("01")).toBeInTheDocument();
    expect(within(region).getByRole("heading", { name: "Popular Movies" })).toBeInTheDocument();
    expect(within(region).getByText("com.linvo.cinemeta")).toBeInTheDocument();
    expect(within(region).getByRole("button", { name: "More" })).toBeInTheDocument();

    const track = within(region).getByRole("list");
    expect(within(track).getAllByRole("listitem")).toHaveLength(2);
  });

  test("keeps each card as one item of the track, in order", () => {
    render(
      <RowTrack title="Continue watching">
        <PosterCard name="First" />
        <PosterCard name="Second" />
        <PosterCard name="Third" />
      </RowTrack>,
    );

    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(within(items[0]!).getByRole("button", { name: "First" })).toBeInTheDocument();
    expect(within(items[1]!).getByRole("button", { name: "Second" })).toBeInTheDocument();
    expect(within(items[2]!).getByRole("button", { name: "Third" })).toBeInTheDocument();
  });

  test("pages one view at a time with an arrow at each edge", () => {
    reduceMotion();
    render(
      <RowTrack title="Popular" columns={4}>
        <PosterCard name="One" />
        <PosterCard name="Two" />
      </RowTrack>,
    );

    const track = screen.getByRole("list");
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 1200 });
    fireEvent.scroll(track);

    const left = screen.getByRole("button", { name: "Scroll Popular left" });
    const right = screen.getByRole("button", { name: "Scroll Popular right" });
    expect(left).toBeDisabled();
    expect(right).toBeEnabled();

    fireEvent.click(right);
    expect(track.scrollLeft, "one press moves exactly one view").toBe(400);

    fireEvent.scroll(track);
    expect(left).toBeEnabled();
    fireEvent.click(left);
    expect(track.scrollLeft, "a second press pages back").toBe(0);
  });

  test("moves with a drag and swallows the card press that would follow it", () => {
    const onOpen = vi.fn();
    render(
      <RowTrack title="Draggable">
        <PosterCard name="A" onClick={onOpen} />
      </RowTrack>,
    );

    const track = screen.getByRole("list");
    fireEvent.pointerDown(track, { pointerId: 1, pointerType: "mouse", clientX: 200 });
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 100 });
    expect(track.scrollLeft).toBe(100);
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 100 });

    fireEvent.click(screen.getByRole("button", { name: "A" }));
    expect(onOpen, "a drag is not a press on the card it ended over").not.toHaveBeenCalled();
  });
});
