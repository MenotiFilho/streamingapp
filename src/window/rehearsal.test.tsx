import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { RehearsalEntry } from "./repertory/RehearsalEntry";

/**
 * The rehearsal is the window with no Host: the same room, driven by the
 * preview Host's own Snapshot. It is here so the browser path is not a fallback
 * nobody tests — the failure this catches is a rehearsal entry that does not
 * boot at all.
 */
describe("the rehearsal entry", () => {
  beforeEach(() => {
    // The preview reads Cinemeta when it builds its Snapshot and the room's
    // rows. This suite is about the mounting, not the Addon: answer with a
    // failed fetch, which the preview already knows how to draw.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("the rehearsal suite has no network");
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("mounts the room from the preview Snapshot", async () => {
    const view = render(<RehearsalEntry />);

    expect(await screen.findByTestId("home-screen")).toBeInTheDocument();

    view.unmount();
    expect(screen.queryByTestId("home-screen")).not.toBeInTheDocument();
  });
});
