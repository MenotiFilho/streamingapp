import { describe, expect, it } from "vitest";

import type { AddonManifest } from "./wire";
import type { ActionError } from "./errors";
import { libraryAddon, libraryExpired, libraryPreview } from "./accountLibrary";

const CINEMETA: AddonManifest = {
  id: "com.linvo.cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [{ name: "meta", types: ["movie", "series"], idPrefixes: ["tt"] }],
  types: ["movie", "series"],
  catalogs: [],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
  enabled: true,
};

const TORRENTIO: AddonManifest = {
  ...CINEMETA,
  id: "torrentio",
  name: "Torrentio",
  resources: [{ name: "stream", types: ["movie", "series"], idPrefixes: ["tt"] }],
};

describe("the account Library's Addon bridge", () => {
  it("picks the first configured Addon whose meta resource answers the item", () => {
    expect(libraryAddon([TORRENTIO, CINEMETA], { id: "tt0133093", type: "movie" })?.id).toBe(
      CINEMETA.id,
    );
    expect(libraryAddon([TORRENTIO], { id: "tt0133093", type: "movie" })).toBeNull();
  });

  it("honours the resource's types and its own id prefixes", () => {
    const onlySeries: AddonManifest = {
      ...CINEMETA,
      resources: [{ name: "meta", types: ["series"], idPrefixes: ["tt"] }],
    };
    expect(libraryAddon([onlySeries], { id: "tt0133093", type: "movie" })).toBeNull();
    expect(libraryAddon([onlySeries], { id: "tt0903747", type: "series" })?.id).toBe(
      onlySeries.id,
    );

    const tmdbs: AddonManifest = {
      ...CINEMETA,
      resources: [{ name: "meta", types: null, idPrefixes: ["tmdb:"] }],
    };
    expect(libraryAddon([tmdbs], { id: "tt0133093", type: "movie" })).toBeNull();
    expect(libraryAddon([tmdbs], { id: "tmdb:603", type: "movie" })?.id).toBe(tmdbs.id);
  });

  it("reads a resource with no prefixes as the Host does: every id", () => {
    const anyId: AddonManifest = {
      ...CINEMETA,
      resources: [{ name: "meta", types: null, idPrefixes: null }],
      idPrefixes: [],
    };
    expect(libraryAddon([anyId], { id: "anything", type: "movie" })?.id).toBe(anyId.id);
  });

  it("skips disabled Addons when picking who opens a library Title", () => {
    const disabled: AddonManifest = { ...CINEMETA, enabled: false };
    const fallback: AddonManifest = { ...CINEMETA, id: "org.example.meta", enabled: true };
    expect(libraryAddon([disabled], { id: "tt0133093", type: "movie" })).toBeNull();
    expect(libraryAddon([disabled, fallback], { id: "tt0133093", type: "movie" })?.id).toBe(
      fallback.id,
    );
  });

  it("carries only the card's identity and art into the Title screen", () => {
    expect(
      libraryPreview({
        id: "tt0133093",
        name: "The Matrix",
        type: "movie",
        poster: "https://images.test/matrix.jpg",
        posterShape: "poster",
        mtime: 1,
        videoId: null,
        position: null,
        duration: null,
        continueWatching: false,
      }),
    ).toEqual({
      id: "tt0133093",
      type: "movie",
      name: "The Matrix",
      poster: "https://images.test/matrix.jpg",
    });
  });

  it("reads an expired Stremio session as a way back in, not an empty room", () => {
    const expired: ActionError = {
      kind: "library",
      detail: "Stremio refused the request: Session does not exist",
    };
    const unreachable: ActionError = {
      kind: "library",
      detail: "Stremio did not answer",
    };

    expect(libraryExpired(expired)).toBe(true);
    expect(libraryExpired(unreachable)).toBe(false);
    expect(libraryExpired(null)).toBe(false);
  });
});
