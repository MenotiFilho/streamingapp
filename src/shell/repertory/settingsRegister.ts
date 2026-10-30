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

export const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  { id: "credentials", title: "Credentials" },
  { id: "preferences", title: "Preferences" },
  { id: "remote-devices", title: "Remote devices" },
  { id: "about", title: "About/Credits" },
];

/** The id a category's pushed level keeps across every screen that opens it. */
export function settingsLevelId(category: SettingsCategory): string {
  return `settings-${category.id}`;
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

/** What About/Credits carries: the app's version and the two required notices. */
export function aboutCredits(version: string): {
  version: string;
  tmdbNotice: string;
  licence: string;
} {
  return { version, tmdbNotice: TMDB_NOTICE, licence: LICENCE };
}
