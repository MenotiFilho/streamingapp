import { describe, expect, test } from "vitest";

import { DESTINATION_NOTES } from "../core/destinationNotes";
import { DESTINATIONS } from "../core/destinations";
import { destinationLabel } from "../core/navigation";
import { placeholderFor } from "./placeholders";

describe("the skeleton's six destinations", () => {
  test("every destination is named by its own label and says what it will hold", () => {
    for (const { id } of DESTINATIONS) {
      const placeholder = placeholderFor(id);
      expect(placeholder.title).toBe(destinationLabel(id));
      expect(placeholder.note).toBe(DESTINATION_NOTES[id]);
      expect(placeholder.note.length).toBeGreaterThan(0);
    }
  });

  test("the six placeholders are six different destinations", () => {
    const titles = DESTINATIONS.map(({ id }) => placeholderFor(id).title);
    expect(new Set(titles).size).toBe(DESTINATIONS.length);
  });
});
