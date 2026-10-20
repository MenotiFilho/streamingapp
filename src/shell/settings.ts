/**
 * The Settings screen's pure readings.
 *
 * Protection is what the Host publishes about where credentials live and which
 * it holds. It is a fact about the machine, so the screen says it in a
 * person's words and decides nothing: a key is held or it is not, and the
 * secret store is the keyring or the owner-only file fallback.
 */

import type { Protection } from "../host-client";

/** The three sentences a Credentials screen reads off one Protection. */
export type ProtectionReadout = {
  /** The sentence naming where a credential would be kept. */
  backend: string;
  /** The sentence saying whether a TMDB key is held. */
  tmdb: string;
  /** The sentence saying whether a Stremio account is signed in. */
  stremio: string;
};

/** Protection, in the words the Credentials sub-screen draws. */
export function protectionReadout(protection: Protection): ProtectionReadout {
  return {
    backend:
      protection.backend === "keyring"
        ? "The OS keyring"
        : "An owner-only (0600) file in the data directory, because no keyring is reachable here",
    tmdb: protection.tmdbHeld ? "A TMDB key is held." : "No TMDB key is held.",
    stremio: protection.stremioHeld
      ? "A Stremio account is signed in."
      : "No Stremio account is signed in.",
  };
}
