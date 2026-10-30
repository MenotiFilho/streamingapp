import { render, screen, within } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { Popover } from "./Popover";

describe("the repertory popover", () => {
  test("is a non-modal dialog named by its label", () => {
    render(
      <Popover label="Subtitles" heading="Subtitles" align="end">
        <button type="button">English</button>
      </Popover>,
    );

    const popover = screen.getByRole("dialog", { name: "Subtitles" });
    expect(popover).not.toHaveAttribute("aria-modal");
    expect(within(popover).getByRole("button", { name: "English" })).toBeInTheDocument();
  });

  test("may carry no heading", () => {
    render(<Popover label="Speed">1×</Popover>);

    const popover = screen.getByRole("dialog", { name: "Speed" });
    expect(within(popover).getByText("1×")).toBeInTheDocument();
  });
});
