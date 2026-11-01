/** The part of a `Location` the socket's URL is decided from. */
export type SocketLocation = { protocol: string; host: string };

/**
 * Where the Remote opens its socket (ADR-0035 §3).
 *
 * A production build is served by the Host itself, so the socket is the page's
 * own origin at `/` — the same address the hand-written page uses. The dev
 * server is Vite's, which is not the Host: `vite.config.ts` proxies `/host` to
 * the wire server, so a developer's browser talks to the Host through the one
 * origin it loaded the page from.
 *
 * The decision is a pure function of where the page came from, so a test can
 * ask both builds without a browser.
 */
export function socketUrl(
  location: SocketLocation,
  dev: boolean = import.meta.env.DEV,
): string {
  const scheme = location.protocol === "https:" ? "wss" : "ws";
  return `${scheme}://${location.host}${dev ? "/host" : "/"}`;
}
