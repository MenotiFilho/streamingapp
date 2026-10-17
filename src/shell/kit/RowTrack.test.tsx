import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Button } from "./Button";
import { PosterCard } from "./PosterCard";
import { RowTrack } from "./RowTrack";

describe("the Row track", () => {
  test("heads one horizontal track with its title, its tag and its action", () => {
    render(
      <RowTrack
        title="Popular Movies"
        tag="com.linvo.cinemeta"
        action={<Button>More</Button>}
        testId="row-popular"
      >
        <PosterCard name="The Matrix" />
        <PosterCard name="Backrooms" />
      </RowTrack>,
    );

    const region = screen.getByRole("region", { name: "Popular Movies" });
    expect(region).toHaveAttribute("data-testid", "row-popular");
    expect(within(region).getByRole("heading", { name: "Popular Movies" })).toBeInTheDocument();
    expect(within(region).getByText("com.linvo.cinemeta")).toHaveClass("kit-tabular");
    expect(within(region).getByRole("button", { name: "More" })).toBeInTheDocument();

    const track = within(region).getByRole("list");
    expect(track).toHaveClass("kit-row-track");
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
    expect(items.map((item) => item.textContent)).toEqual(["First", "Second", "Third"]);
  });

  test("omits the tag and the action when a row has neither", () => {
    render(
      <RowTrack title="Empty row">
        <></>
      </RowTrack>,
    );

    const region = screen.getByRole("region", { name: "Empty row" });
    expect(region.querySelector(".kit-row-tag")).toBeNull();
    expect(region.querySelector(".kit-row-action")).toBeNull();
  });
});
