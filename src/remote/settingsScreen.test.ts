import { describe, expect, test } from "vitest";

import { declaredCatalogs } from "../core/browse";
import {
  SETTINGS_CATEGORIES,
  settingsLevelId,
  settingsLevelName,
} from "../core/settingsRegister";
import type { AddonManifest } from "../core/wire";
import { NOTHING, PHONE } from "./fakeSocket.testing";
import {
  bufferAfter,
  bufferRequest,
  clearTmdbLevel,
  colorRequest,
  featuredRequest,
  LANGUAGE_GROUP_HEADS,
  LONG_PRESS_MS,
  LONG_PRESS_SLOP,
  pressVerdict,
  revokeLevel,
  scaleRequest,
  settingsCategoryOf,
  settingsLevel,
  signInRequest,
  signOutLevel,
  tmdbKeyRequest,
} from "./settingsScreen";

/**
 * The Settings screen's own decisions (#211, ADR-0032).
 *
 * The register's categories, their level ids and names, the ledger and the
 * About copy are the core's `settingsRegister` and are tested there. What this
 * suite asks is what the screen decides on its own: which level a press pushes,
 * what each form sends, and what the destructive controls ask before anything
 * leaves.
 */

const ADDON = {
  id: "cinemeta",
  name: "Cinemeta",
  version: "3.0.14",
  resources: [],
  types: ["movie"],
  catalogs: [{ type: "movie", id: "top", name: "Top", extra: [] }],
  idPrefixes: ["tt"],
  behaviorHints: { configurable: false, configurationRequired: false },
} satisfies AddonManifest;

describe("the Settings register's levels", () => {
  test("every category is pushed with the register's own id and name", () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(settingsLevel(category)).toEqual({
        id: settingsLevelId(category),
        name: settingsLevelName(category),
        kind: "overlay",
        payload: { kind: "settings", category: category.id },
      });
    }
  });

  test("a level's category id reads back as the category it names", () => {
    for (const category of SETTINGS_CATEGORIES) {
      expect(settingsCategoryOf(category.id)).toBe(category);
    }
  });
});

describe("the Credentials leaf's forms", () => {
  test("an empty field is not a key, and a pasted one is sent trimmed", () => {
    expect(tmdbKeyRequest("   \n\t ")).toBeNull();
    expect(tmdbKeyRequest("  the-key  ")).toEqual({
      type: "set_tmdb_key",
      key: "the-key",
    });
  });

  test("sign-in trims the address, sends the password as typed, and waits for both", () => {
    expect(signInRequest("  owner@example.com ", " hunter2 ")).toEqual({
      type: "sign_in_stremio",
      email: "owner@example.com",
      password: " hunter2 ",
    });
    expect(signInRequest(" ", "hunter2")).toBeNull();
    expect(signInRequest("owner@example.com", "")).toBeNull();
  });

  test("clearing the key is a question that carries clear_tmdb_key", () => {
    const level = clearTmdbLevel();

    expect(level.id).toBe("confirm-clear-tmdb");
    expect(level.name).toBe("Clear the TMDB key?");
    expect(level.kind).toBe("overlay");
    expect(level.payload).toMatchObject({
      kind: "confirm",
      confirm: {
        id: "confirm-clear-tmdb",
        title: "Clear the TMDB key?",
        action: { type: "clear_tmdb_key" },
      },
    });
  });

  test("signing out is a question that carries sign_out_stremio", () => {
    const level = signOutLevel();

    expect(level.kind).toBe("overlay");
    expect(level.payload).toMatchObject({
      kind: "confirm",
      confirm: {
        id: "confirm-sign-out-stremio",
        action: { type: "sign_out_stremio" },
      },
    });
  });
});

describe("the Preferences leaf's Actions", () => {
  test("the two language groups are named as the Host's lists are", () => {
    expect(LANGUAGE_GROUP_HEADS).toEqual({
      subtitle: "Subtitle languages",
      audio: "Audio languages",
    });
  });

  test("appearance and the Featured catalog are the Host's own Actions", () => {
    expect(colorRequest("#FFFF00")).toEqual({
      type: "set_subtitle_color",
      color: "#FFFF00",
    });
    expect(scaleRequest(1.25)).toEqual({ type: "set_subtitle_scale", scale: 1.25 });
    expect(featuredRequest(null)).toEqual({ type: "clear_featured_catalog" });

    const catalog = declaredCatalogs({ ...NOTHING, addons: [ADDON] })[0];
    if (!catalog) {
      throw new Error("the fixture Addon declares one Catalog");
    }
    expect(featuredRequest(catalog)).toEqual({
      type: "set_featured_catalog",
      addon: ADDON.id,
      catalog: { type: catalog.catalog.type, id: catalog.catalog.id },
    });
  });

  test("one press moves one half of the buffer pair and keeps the other", () => {
    const held = { seconds: 300, megabytes: 512 };

    expect(bufferAfter(held, { seconds: 600 })).toEqual({
      seconds: 600,
      megabytes: 512,
    });
    expect(bufferAfter(held, { megabytes: 1024 })).toEqual({
      seconds: 300,
      megabytes: 1024,
    });
    expect(bufferRequest(bufferAfter(held, { seconds: 60 }))).toEqual({
      type: "set_stream_buffer",
      seconds: 60,
      megabytes: 512,
    });
  });
});

describe("revoking a device", () => {
  test("is a question named for the device, carrying revoke_device", () => {
    const level = revokeLevel(PHONE);

    expect(level.id).toBe(`confirm-revoke-${PHONE.id}`);
    expect(level.name).toBe(`Revoke ${PHONE.name}?`);
    expect(level.payload).toMatchObject({
      kind: "confirm",
      confirm: {
        confirmLabel: "Revoke",
        action: { type: "revoke_device", id: PHONE.id },
      },
    });
  });
});

describe("the long-press that starts a chip's drag", () => {
  test("a press held about half a second without travelling starts a drag", () => {
    expect(LONG_PRESS_MS).toBeGreaterThanOrEqual(400);
    expect(LONG_PRESS_MS).toBeLessThanOrEqual(600);
    expect(pressVerdict({ heldMs: LONG_PRESS_MS, travelled: 0 })).toBe("drag");
    expect(pressVerdict({ heldMs: LONG_PRESS_MS + 200, travelled: LONG_PRESS_SLOP })).toBe("drag");
  });

  test("a press shorter than the threshold is still waiting, and a tap never drags", () => {
    expect(pressVerdict({ heldMs: 0, travelled: 0 })).toBe("wait");
    expect(pressVerdict({ heldMs: LONG_PRESS_MS - 1, travelled: LONG_PRESS_SLOP })).toBe("wait");
  });

  test("a move before the threshold is a swipe: the page scrolls and no drag starts", () => {
    expect(pressVerdict({ heldMs: 100, travelled: LONG_PRESS_SLOP + 1 })).toBe("scroll");
    expect(pressVerdict({ heldMs: LONG_PRESS_MS - 1, travelled: 40 })).toBe("scroll");
  });
});
