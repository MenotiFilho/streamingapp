import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";

import { PosterCard } from "./PosterCard";
import { RowTrack } from "./RowTrack";

const { animateMock } = vi.hoisted(() => ({ animateMock: vi.fn() }));

vi.mock("motion/react", () => ({ animate: animateMock }));

afterEach(() => {
  animateMock.mockReset();
  vi.unstubAllGlobals();
});

function motionWindow(reduced: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: reduced,
      media: "(prefers-reduced-motion: reduce)",
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

function layOutTrack() {
  const track = screen.getByRole("list");
  Object.defineProperty(track, "clientWidth", { configurable: true, value: 400 });
  Object.defineProperty(track, "scrollWidth", { configurable: true, value: 1200 });
  const cards = track.querySelectorAll<HTMLElement>(".rep-kit-row-item");
  cards.forEach((card, index) => {
    const left = index * 100;
    vi.spyOn(card, "getBoundingClientRect").mockReturnValue({
      x: left,
      y: 0,
      width: 76,
      height: 240,
      left,
      top: 0,
      right: left + 76,
      bottom: 240,
      toJSON: () => ({}),
    } as DOMRect);
  });
  fireEvent.scroll(track);
  return track;
}

describe("the row track's paging", () => {
  test("a second press stops the page in flight and starts the next one", () => {
    motionWindow(false);
    const first = { stop: vi.fn() };
    const second = { stop: vi.fn() };
    animateMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    render(
      <RowTrack title="Popular" columns={5.5} page={5}>
        <PosterCard name="One" />
        <PosterCard name="Two" />
      </RowTrack>,
    );
    layOutTrack();

    const right = screen.getByRole("button", { name: "Scroll Popular right" });
    fireEvent.click(right);
    fireEvent.click(right);

    expect(animateMock, "the second press redirects rather than queueing").toHaveBeenCalledTimes(2);
    expect(first.stop, "the page already travelling is stopped").toHaveBeenCalledTimes(1);
  });

  test("reduced motion jumps instead of animating the offset", () => {
    motionWindow(true);
    render(
      <RowTrack title="Popular" columns={5.5} page={5}>
        <PosterCard name="One" />
        <PosterCard name="Two" />
      </RowTrack>,
    );
    const track = layOutTrack();

    fireEvent.click(screen.getByRole("button", { name: "Scroll Popular right" }));

    expect(animateMock).not.toHaveBeenCalled();
    expect(track.scrollLeft, "five card pitches straight away").toBe(500);
  });
});
