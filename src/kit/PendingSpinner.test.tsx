import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";

import { PendingSpinner } from "./PendingSpinner";

describe("the repertory pending spinner", () => {
  test("is one decorative mark: the wait is announced by the control, not the ring", () => {
    render(<PendingSpinner />);

    const spinner = screen.getByTestId("pending-spinner");
    expect(spinner).toHaveAttribute("aria-hidden", "true");
  });
});
