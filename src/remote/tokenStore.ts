/**
 * The key the Device token is kept under. It was the hand-written page's key,
 * and the staging route shared its origin, so a phone paired before the
 * cutover is still paired at `/` (ADR-0035 §1).
 */
export const TOKEN_KEY = "streamingapp.device.token";

/**
 * Where a paired Device's token lives between visits.
 *
 * The token is the link's to keep, never the core's to carry: `WebSocketLink`
 * reads it for a greeting, writes it from a pairing answer, and takes it out of
 * every answer before the Session sees one (ADR-0035 §1).
 */
export type TokenStore = {
  /** The token this device was paired with, or nothing. */
  read(): string | null;
  /** Keep a token a pairing just issued. */
  write(token: string): void;
  /** Forget the token: the Host no longer knows this device. */
  clear(): void;
};

/** The three storage calls a token store needs; `localStorage` has them. */
export type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * A token store over one storage.
 *
 * Storage can refuse — a private window, a browser with site data turned off —
 * and a page that cannot remember a token is still a page that can pair for
 * this visit. So a refused read is "no token" and a refused write is a pairing
 * that lasts until the tab closes; neither is an error the person must fix.
 */
export function storageTokenStore(storage: TokenStorage): TokenStore {
  return {
    read() {
      try {
        return storage.getItem(TOKEN_KEY);
      } catch {
        return null;
      }
    },
    write(token) {
      try {
        storage.setItem(TOKEN_KEY, token);
      } catch {
        // The pairing lasts for this visit.
      }
    },
    clear() {
      try {
        storage.removeItem(TOKEN_KEY);
      } catch {
        // There was nothing this page could have kept.
      }
    },
  };
}

/** The browser's own storage, behind the store the link reads. */
export function browserTokenStore(): TokenStore {
  return storageTokenStore({
    getItem: (key) => window.localStorage.getItem(key),
    setItem: (key, value) => window.localStorage.setItem(key, value),
    removeItem: (key) => window.localStorage.removeItem(key),
  });
}
