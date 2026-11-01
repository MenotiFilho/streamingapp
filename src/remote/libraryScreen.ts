import { libraryAddon, libraryExpired, libraryPreview } from "../core/accountLibrary";
import type { ActionError } from "../core/errors";
import type { NewLevel } from "../core/navigation";
import type { AddonManifest, Library, LibraryEntry } from "../core/wire";
import { titleLevelOf, type RemotePayload } from "./levels";

/**
 * The Library screen's own decisions and words (#208, ADR-0035 §1).
 *
 * The account Library is not the Host's Snapshot: it is a question, answered to
 * the client that asked, and the screen holds the answer for the visit. What
 * lives here is only what draws from that answer — the four states a read can
 * be in, the way out of each failure, the signed-out offer, and the card each
 * entry becomes. The Addon bridge and the expired-session reading are the
 * core's `accountLibrary` (ADR-0029).
 */

/** The one ask a Library read is: the account's Library, once per visit. */
export const LIBRARY_ASK = { type: "library" } as const;

/** What the Library screen is doing, decided from the answer and the Session. */
export type LibraryPhase = "reading" | "empty" | "list" | "failure";

/**
 * The failure a read is answered with, whether the link refused the ask or the
 * answer carried its own: both are the Host's words, and neither is an empty
 * account (ADR-0029).
 */
export function libraryFailure(
  answer: Library | null,
  refused: ActionError | null,
): ActionError | null {
  return refused ?? answer?.failure ?? null;
}

/**
 * The screen's state. A failure wins while it is held, because the retry's wait
 * is drawn on its own control; no answer yet is a wait rather than an account
 * that happens to be empty; and an account with nothing saved is an answer.
 */
export function libraryPhase(
  answer: Library | null,
  refused: ActionError | null,
  reading: boolean,
): LibraryPhase {
  if (libraryFailure(answer, refused)) {
    return "failure";
  }
  if (reading || answer === null) {
    return "reading";
  }
  return answer.entries.length === 0 ? "empty" : "list";
}

/** The control that is the way back into the account, from either dead end. */
export const LIBRARY_SETTINGS_CONTROL = "Open Settings";

/** The control a failure that is not an expired session offers. */
export const LIBRARY_RETRY_CONTROL = "Try again";

/**
 * The gate with no Stremio account linked. Sign-in is the Settings screen's
 * (B7), so the offer is a destination change and the body says where the
 * account is linked rather than drawing credentials here.
 */
export const SIGNED_OUT = {
  kicker: "Stremio account",
  title: "Sign in to read your Library.",
  body: "Your Library holds the Titles saved in your Stremio account. Sign in to Stremio in Settings to read it; membership is not built.",
  control: LIBRARY_SETTINGS_CONTROL,
} as const;

/** The read while it is in flight, on the first mount and on a retry. */
export const LIBRARY_READING = "Reading the account Library…";

/** An account with nothing saved: an answer, not a failure. */
export const LIBRARY_EMPTY = {
  title: "The Library is empty.",
  body: "Titles saved in your Stremio account will appear here.",
} as const;

/** What a failure says beside the Host's own words, and the control it offers. */
export type LibraryFailureCopy =
  | { note: string; control: "settings" }
  | { note: null; control: "retry" };

/**
 * The way out of a failed read. An expired Stremio session is the account
 * again, never an empty Library (ADR-0029), so it is read with the core's
 * `libraryExpired` and points at Settings; anything else is explained and asked
 * again, with no second line over the Host's.
 */
export function libraryFailureCopy(failure: ActionError): LibraryFailureCopy {
  if (libraryExpired(failure)) {
    return {
      note: "The Stremio session has expired. Sign in again in Settings to read your Library.",
      control: "settings",
    };
  }
  return { note: null, control: "retry" };
}

/** One entry as its card decides it. */
export type LibraryCard = {
  entry: LibraryEntry;
  /** Whether the card is a control: no Addon means a still, not a press. */
  openable: boolean;
  /** The account's own Continue mark, carried untouched. */
  continueWatching: boolean;
  /** The Title level a press pushes, where the card opens. */
  level: NewLevel<RemotePayload> | null;
};

/**
 * The account's entries, each decided against the configured Addons. A press
 * opens the Title through B3's level — its identity, and the Addon whose
 * `meta` resource answers it — and an entry with no such Addon keeps its
 * picture and its mark and pushes nothing (ADR-0020, ADR-0029).
 */
export function libraryCards(
  addons: readonly AddonManifest[],
  entries: readonly LibraryEntry[],
): LibraryCard[] {
  return entries.map((entry) => {
    const addon = libraryAddon(addons, entry);
    return {
      entry,
      openable: addon !== null,
      continueWatching: entry.continueWatching,
      level: addon ? titleLevelOf(addon.id, libraryPreview(entry)) : null,
    };
  });
}
