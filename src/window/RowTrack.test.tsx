import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { markNavigation, markPointer } from "../core/inputModality";
import { ChoiceChip } from "../kit/Chip";
import { PosterCard } from "../kit/PosterCard";
import { readLevel } from "./layout";
import { focusAndReveal } from "./reveal";
import { RowTrack } from "./RowTrack";

afterEach(() => {
  markPointer();
  vi.restoreAllMocks();
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

/** Give a content track's chips their own widths, one gap apart. */
function layOutContent(track: HTMLElement, widths: readonly number[], gap = 16) {
  const items = track.querySelectorAll<HTMLElement>(".rep-kit-row-item");
  let left = 0;
  items.forEach((item, index) => {
    const width = widths[index] ?? 0;
    const box = {
      x: left,
      y: 0,
      width,
      height: 40,
      left,
      top: 0,
      right: left + width,
      bottom: 40,
      toJSON: () => ({}),
    } as DOMRect;
    vi.spyOn(item, "getBoundingClientRect").mockReturnValue(box);
    const chip = item.firstElementChild;
    if (chip instanceof HTMLElement) {
      vi.spyOn(chip, "getBoundingClientRect").mockReturnValue(box);
    }
    left += width + gap;
  });
}

/** A chip whose client box follows the track's scroll, as a real browser's does. */
function layOutChipAt(
  track: HTMLElement,
  chip: HTMLElement,
  left: number,
  width = 100,
) {
  vi.spyOn(chip, "getBoundingClientRect").mockImplementation(
    () =>
      ({
        x: left - track.scrollLeft,
        y: 100,
        width,
        height: 40,
        left: left - track.scrollLeft,
        top: 100,
        right: left - track.scrollLeft + width,
        bottom: 140,
        toJSON: () => ({}),
      }) as DOMRect,
  );
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

describe("the row track over items of varying width", () => {
  const chips = ["All genres", "Drama", "Comedy", "Horror", "Action", "Science Fiction"];

  test("pages a content rail by the chips one view holds, from start to end", () => {
    reduceMotion();
    render(
      <RowTrack label="Genres" itemLayout="content">
        {chips.map((name) => (
          <ChoiceChip key={name} pressed={name === "All genres"}>
            {name}
          </ChoiceChip>
        ))}
      </RowTrack>,
    );

    const track = screen.getByRole("list");
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 900 });
    layOutContent(track, [90, 70, 110, 80, 100, 120]);
    fireEvent.scroll(track);

    const left = screen.getByRole("button", { name: "Scroll Genres left" });
    const right = screen.getByRole("button", { name: "Scroll Genres right" });
    expect(left, "the first chip is already at the leading edge").toBeDisabled();
    expect(right).toBeEnabled();

    fireEvent.click(right);
    expect(track.scrollLeft, "the two whole chips in this view, not a fixed pitch").toBe(192);
    expect(left, "a page on is no longer the start").toBeEnabled();
    expect(right, "and it has not reached the end").toBeEnabled();

    track.scrollLeft = 600;
    fireEvent.scroll(track);
    expect(left).toBeEnabled();
    expect(right, "the last chips are in view").toBeDisabled();

    fireEvent.click(left);
    expect(track.scrollLeft, "a page back lands on the chip before the view").toBe(414);
  });

  test("a drag across the chips swallows the press it ends over", () => {
    const onChoose = vi.fn();
    render(
      <RowTrack label="Genres" itemLayout="content">
        <ChoiceChip pressed={false} onClick={onChoose}>
          Drama
        </ChoiceChip>
      </RowTrack>,
    );

    const track = screen.getByRole("list");
    fireEvent.pointerDown(track, { pointerId: 1, pointerType: "mouse", clientX: 200 });
    fireEvent.pointerMove(track, { pointerId: 1, clientX: 100 });
    expect(track.scrollLeft).toBe(100);
    fireEvent.pointerUp(track, { pointerId: 1, clientX: 100 });

    fireEvent.click(screen.getByRole("button", { name: "Drama" }));
    expect(onChoose, "a drag is not a press on the chip it ended over").not.toHaveBeenCalled();
  });

  test("moving focus along the chips brings the focused one into view", () => {
    markNavigation();
    render(
      <div data-region="discover-genres" data-kind="row" data-label="Genres">
        <RowTrack label="Genres" itemLayout="content">
          {chips.map((name) => (
            <ChoiceChip key={name} pressed={false}>
              {name}
            </ChoiceChip>
          ))}
        </RowTrack>
      </div>,
    );

    const track = screen.getByRole("list");
    track.style.overflowX = "auto";
    Object.defineProperty(track, "clientWidth", { configurable: true, value: 300 });
    Object.defineProperty(track, "clientHeight", { configurable: true, value: 56 });
    Object.defineProperty(track, "scrollWidth", { configurable: true, value: 900 });

    const horror = screen.getByRole("button", { name: "Horror" });
    layOutChipAt(track, horror, 400, 110);

    focusAndReveal(horror);

    expect(document.activeElement).toBe(horror);
    expect(track.scrollLeft, "the chip clears the 24px margin at the row's right").toBe(234);
  });
});
