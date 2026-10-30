import type { Protection } from "../../host-client";

/**
 * The Settings register's decisions, kept out of the drawing (ADR-0032).
 *
 * The four categories are the Host's own and stay in the record's order; a
 * category is one pushed level, so its id and display name are decided once.
 * The Credentials ledger is short by design: where the secret lives and whether
 * each credential is held, not a paragraph about each one.
 */

export type SettingsCategoryId =
  | "credentials"
  | "preferences"
  | "remote-devices"
  | "about";

export type SettingsCategory = {
  id: SettingsCategoryId;
  title: string;
};

export const CREDENTIALS_CATEGORY: SettingsCategory = {
  id: "credentials",
  title: "Credentials",
};

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  CREDENTIALS_CATEGORY,
  { id: "preferences", title: "Preferences" },
  { id: "remote-devices", title: "Remote devices" },
  { id: "about", title: "About/Credits" },
];

/** Every Settings leaf's level id begins with this, so the frame can keep the spine live. */
export const SETTINGS_LEVEL_PREFIX = "settings-";

/** The id a category's pushed level keeps across every screen that opens it. */
export function settingsLevelId(category: SettingsCategory): string {
  return `${SETTINGS_LEVEL_PREFIX}${category.id}`;
}

/** What the level is called in the stack and on its own head. */
export function settingsLevelName(category: SettingsCategory): string {
  return `Settings — ${category.title}`;
}

/** The Credentials ledger, in the short words the register prints. */
export type ProtectionLedger = {
  backend: string;
  tmdb: string;
  stremio: string;
};

export function protectionLedger(protection: Protection): ProtectionLedger {
  return {
    backend:
      protection.backend === "keyring"
        ? "OS keyring"
        : "Owner-only (0600) file",
    tmdb: protection.tmdbHeld ? "Held" : "Not held",
    stremio: protection.stremioHeld ? "Signed in" : "Not signed in",
  };
}

/** The line a saved TMDB key logs; the ledger itself is the durable answer. */
export const TMDB_KEY_SAVED = "The Host holds the TMDB key.";

/** The Featured catalog's empty state when no Addon offers a Catalog. */
export const NO_CATALOG = "No configured Addon offers a Catalog.";

/**
 * A subtitle language the Host holds but this client's presets do not name:
 * an Other chip, so one value is still selected rather than every chip bare.
 */
export function unknownLanguageLabel(tag: string): string {
  return `Other (${tag})`;
}

/** The TMDB notice the API's terms require, carried on About/Credits. */
export const TMDB_NOTICE =
  "This product uses the TMDB API but is not endorsed or certified by TMDB";

/** The app's licence, in the words its About screen prints. */
export const LICENCE =
  "streamingapp is free software, released under the GNU General Public License, version 3 or later (GPL-3.0-or-later). Playback uses mpv (libmpv), whose default build is GPLv2 or later, linked in-process so the video surface stays mpv's own.";
