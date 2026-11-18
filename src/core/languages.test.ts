import { describe, expect, test } from "vitest";

import {
  FOLLOW_THE_FILE,
  FOLLOW_THE_FILE_AUDIO_LINE,
  FOLLOW_THE_FILE_SUBTITLE_LINE,
  LANGUAGES,
  languageName,
} from "./languages";

describe("the curated language list", () => {
  test("every tag is unique and every language has a name", () => {
    const tags = LANGUAGES.map((language) => language.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(LANGUAGES.every((language) => language.name.length > 0)).toBe(true);
    expect(LANGUAGES.length).toBeGreaterThan(10);
  });

  test("a known tag reads as its language, and an unknown one stands as itself", () => {
    expect(languageName("pt-BR")).toBe("Português (Brasil)");
    expect(languageName("xx")).toBe("xx");
  });

  test("an empty list is called following the file, and each list says what that means", () => {
    expect(FOLLOW_THE_FILE).toBe("Follow the file");
    expect(FOLLOW_THE_FILE_SUBTITLE_LINE).toBe(
      "The subtitle the file marks as default, if it has one.",
    );
    expect(FOLLOW_THE_FILE_AUDIO_LINE).toBe("The soundtrack the file marks as default.");
  });
});
