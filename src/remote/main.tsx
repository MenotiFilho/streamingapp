import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { RemoteApp } from "./RemoteApp";
import { socketUrl } from "./socketUrl";
import { browserTokenStore } from "./tokenStore";
import { WebSocketLink } from "./websocketLink";
import "./remote.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the Remote has no root element to render into");
}

/**
 * The served Remote's entry (ADR-0035 §3).
 *
 * One link per page, built here rather than in a render: a render may run twice
 * (StrictMode does), and two links would be two sockets. The socket's URL
 * follows the page's own origin, the Device token lives in the same store the
 * hand-written page used, and the app is handed the one door.
 */
const link = new WebSocketLink({
  url: socketUrl(window.location),
  tokens: browserTokenStore(),
});

createRoot(root).render(
  <StrictMode>
    <RemoteApp link={link} />
  </StrictMode>,
);
