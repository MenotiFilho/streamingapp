import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PosterCard } from "../kit/PosterCard";
import { readLevel } from "./layout";
import { RowTrack } from "./RowTrack";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Give the track's items a measured card pitch; jsdom lays nothing out. */
function layOutPitch(track: HTMLElement, pitch: number) {
  const cards = track.querySelectorAll<HTMLElement>(".rep-kit-row-item");
  cards.forEach((card, index) => {
    const left = index * pitch;
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      x: left,
      y: 0,
      width: pitch - 24,
      height: 240,
      left,
      top: 0,
      right: left + pitch - 24,
      bottom: 240,
      toJSON: () => ({}),
    } as DOMRect);
  });
}

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

  test("pages five whole cards at a time with an arrow at each edge", () => {
    reduceMotion();
    render(
      <RowTrack title="Popular" columns={5.5} page={5}>
        <PosterCard name="One" />
        <PosterCard name="Two" />
        <PosterCard name="Three" />
      </RowTrack>,
    );

    const track = screen.getByRole("list");
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 1200 });
    layOutPitch(track, 100);
    fireEvent.scroll(track);

    const left = screen.getByRole("button", { name: "Scroll Popular left" });
    const right = screen.getByRole("button", { name: "Scroll Popular right" });
    expect(left).toBeDisabled();
    expect(right).toBeEnabled();

    fireEvent.click(right);
    expect(track.scrollLeft, "five card pitches, not a 400px viewport").toBe(500);

    fireEvent.scroll(track);
    expect(left).toBeEnabled();
    fireEvent.click(left);
    expect(track.scrollLeft, "a second press pages back").toBe(0);
  });

  test("offers the cards to the focus model and not the paging arrows", () => {
    render(
      <div data-region="row:popular" data-kind="row" data-label="Popular" data-testid="row">
        <RowTrack title="Popular" columns={5.5} page={5}>
          <PosterCard name="One" />
          <PosterCard name="Two" />
        </RowTrack>
      </div>,
    );

    const track = screen.getByRole("list");
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 400 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 1200 });
    fireEvent.scroll(track);
    expect(
      screen.getByRole("button", { name: "Scroll Popular right" }),
      "the arrow is enabled, so the focus model skips it for what it is, not for a disabled state",
    ).toBeEnabled();

    const { elements } = readLevel(screen.getByTestId("row"), {});

    expect(elements["row:popular"]).toEqual([
      screen.getByRole("button", { name: "One" }),
      screen.getByRole("button", { name: "Two" }),
    ]);
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
