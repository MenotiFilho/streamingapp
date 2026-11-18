import type { DeclaredCatalog } from "../core/browse";
import type { NewLevel } from "../core/navigation";
import {
  CREDENTIALS_CATEGORY,
  SETTINGS_CATEGORIES,
  settingsLevelId,
  settingsLevelName,
  type SettingsCategory,
  type SettingsCategoryId,
} from "../core/settingsRegister";
import type { Action, DeviceSummary } from "../core/wire";
import type { RemotePayload } from "./levels";

/**
 * The Settings screen's own decisions and words (#211, ADR-0035 §1).
 *
 * The register's four categories, their level ids and names, the protection
 * ledger and the About copy are the core's `settingsRegister`; the lists a
 * preference is chosen from are the core's JSON. What lives here is only what
 * this client decides: which level a press pushes, what each form sends, the
 * confirmations a destructive press raises, and the words the leaves print.
 */

/**
 * The four categories are the Host's, in the record's order; this names one.
 *
 * The id is the register's own closed union and every Settings level is pushed
 * by `settingsLevel` below, so the lookup always hits; the fallback is what
 * keeps the function total for the type checker without a thrown render.
 */
export function settingsCategoryOf(id: SettingsCategoryId): SettingsCategory {
  return (
    SETTINGS_CATEGORIES.find((category) => category.id === id) ??
    CREDENTIALS_CATEGORY
  );
}

/**
 * The level a press on one category pushes. The id and the name are the
 * register's, so Back returns to the row that opened it and a second client
 * names the leaf the same way.
 */
export function settingsLevel(
  category: SettingsCategory,
): NewLevel<RemotePayload> {
  return {
    id: settingsLevelId(category),
    name: settingsLevelName(category),
    kind: "overlay",
    payload: { kind: "settings", category: category.id },
  };
}

/** Before the first Snapshot there is nothing honest to draw but the wait. */
export const SETTINGS_WAITING = "Waiting for the Host…";

/* ---------------------------------------------------------------- Credentials */

/** The one field the TMDB key is pasted into. */
export const TMDB_FIELD_LABEL = "TMDB API key or read-access token";
export const TMDB_FIELD_PLACEHOLDER = "the key TMDB gave you";
export const TMDB_SAVE = "Save key";
export const TMDB_CLEAR = "Clear key";

/** The Stremio account's two fields and its two controls. */
export const STREMIO_EMAIL_LABEL = "Stremio email";
export const STREMIO_EMAIL_PLACEHOLDER = "you@example.com";
export const STREMIO_PASSWORD_LABEL = "Stremio password";
export const STREMIO_PASSWORD_PLACEHOLDER = "the password Stremio knows";
export const STREMIO_SIGN_IN = "Sign in";
export const STREMIO_SIGN_OUT = "Sign out";

/**
 * The Action a Save press asks for, or null where there is nothing to ask: an
 * empty or whitespace field is not a key, and the Host is never sent a guess.
 */
export function tmdbKeyRequest(draft: string): Action | null {
  const key = draft.trim();
  return key === "" ? null : { type: "set_tmdb_key", key };
}

/**
 * The Action a Sign in press asks for, or null where the pair is not one yet.
 * The address is trimmed; the password is sent exactly as it was typed, because
 * a password may begin or end with a space and the Host is the one that judges
 * it.
 */
export function signInRequest(email: string, password: string): Action | null {
  const address = email.trim();
  if (address === "" || password === "") {
    return null;
  }
  return { type: "sign_in_stremio", email: address, password };
}

/** The question a Clear key press pushes; nothing leaves until it is answered. */
export function clearTmdbLevel(): NewLevel<RemotePayload> {
  return confirmLevel({
    id: "confirm-clear-tmdb",
    title: "Clear the TMDB key?",
    body: "The Host stops asking TMDB until a key is saved again. Discover and keyed Search say so instead of answering.",
    confirmLabel: TMDB_CLEAR,
    action: { type: "clear_tmdb_key" },
  });
}

/** The question a Sign out press pushes, in the window's own words. */
export function signOutLevel(): NewLevel<RemotePayload> {
  return confirmLevel({
    id: "confirm-sign-out-stremio",
    title: "Sign out of Stremio?",
    body: "The Host stops syncing Watch progress with this account. Progress already merged stays recorded.",
    confirmLabel: STREMIO_SIGN_OUT,
    action: { type: "sign_out_stremio" },
  });
}

/* ---------------------------------------------------------------- Preferences */

/** The section labels the Preferences leaf prints, in reading order. */
export const SUBTITLE_LANGUAGE_HEAD = "Subtitle language";
export const SUBTITLE_COLOUR_HEAD = "Subtitle colour";
export const SUBTITLE_SIZE_HEAD = "Subtitle size";
export const STREAM_BUFFER_HEAD = "Stream buffer";
export const STREAM_BUFFER_SECONDS_HEAD = "Look-ahead";
export const STREAM_BUFFER_MEGABYTES_HEAD = "Memory ceiling";
export const UP_NEXT_HEAD = "Up next";
export const FEATURED_CATALOG_HEAD = "Featured catalog";
export const FEATURED_NONE = "No featured catalog";

/**
 * The one preference that is an absence: the Host follows the file rather
 * than preferring one, so the choice sends the clear rather than an
 * empty tag.
 */
export function languageRequest(tag: string | null): Action {
  return tag === null
    ? { type: "clear_subtitle_language" }
    : { type: "set_subtitle_language", language: tag };
}

export function colorRequest(color: string): Action {
  return { type: "set_subtitle_color", color };
}

export function scaleRequest(scale: number): Action {
  return { type: "set_subtitle_scale", scale };
}

/** The look-ahead and the memory that look-ahead may take, always as a pair. */
export type StreamBuffer = { seconds: number; megabytes: number };

/**
 * One press moves one half of the pair and keeps the other where the client
 * last put it, so two quick presses compose instead of the second reverting the
 * first (ADR-0026).
 */
export function bufferAfter(
  held: StreamBuffer,
  change: Partial<StreamBuffer>,
): StreamBuffer {
  return {
    seconds: change.seconds ?? held.seconds,
    megabytes: change.megabytes ?? held.megabytes,
  };
}

/** One Action carries the pair, so the Host cannot half-apply it (ADR-0026). */
export function bufferRequest(pair: StreamBuffer): Action {
  return { type: "set_stream_buffer", ...pair };
}

/**
 * The Featured catalog choice: one Catalog an Addon declared, or none at all.
 * The Addon travels beside the Catalog because a catalog id is only unique
 * within the Addon that declared it.
 */
export function featuredRequest(choice: DeclaredCatalog | null): Action {
  return choice === null
    ? { type: "clear_featured_catalog" }
    : {
        type: "set_featured_catalog",
        addon: choice.addon,
        catalog: { type: choice.catalog.type, id: choice.catalog.id },
      };
}

/* ------------------------------------------------------------- Remote devices */

export const ADDRESS_LABEL = "Address";
export const PAIRING_CODE_LABEL = "Pairing code · single use";
export const ADDRESS_ABSENT = "This Host is not serving the network.";
export const NO_DEVICES = "No device is paired yet.";
export const REVOKE = "Revoke";

/** The question a Revoke press pushes; the token leaves only on the answer. */
export function revokeLevel(
  device: Pick<DeviceSummary, "id" | "name">,
): NewLevel<RemotePayload> {
  return confirmLevel({
    id: `confirm-revoke-${device.id}`,
    title: `Revoke ${device.name}?`,
    body: "The device's token stops working immediately. Every other paired device keeps working.",
    confirmLabel: REVOKE,
    action: { type: "revoke_device", id: device.id },
  });
}

/** A paired-at stamp as a ledger would print it. */
export function pairedAt(milliseconds: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(milliseconds));
}

/* ------------------------------------------------------------- About/Credits */

/** The term the version row is printed against. */
export const VERSION_TERM = "streamingapp";

/** The mark's own name, read as the image's alternative text. */
export const TMDB_MARK = "TMDB";

/* -------------------------------------------------------------------- shared */

/**
 * One destructive question, as a level: its words, its confirming label and the
 * one Action the confirming answer takes. Data and never a closure, so the
 * level stack stays the core's (B5's `RemoteConfirm`).
 */
function confirmLevel({
  id,
  title,
  body,
  confirmLabel,
  action,
}: {
  id: string;
  title: string;
  body: string;
  confirmLabel: string;
  action: Action;
}): NewLevel<RemotePayload> {
  return {
    id,
    name: title,
    kind: "overlay",
    payload: {
      kind: "confirm",
      confirm: { id, title, body, confirmLabel, action },
    },
  };
}
