import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { installInputModality } from "../core/inputModality";
import { installPointerPress } from "../core/react/pointerPress";
import { RemoteApp } from "./RemoteApp";
import { socketUrl } from "./socketUrl";
import { browserTokenStore } from "./tokenStore";
import { WebSocketLink } from "./websocketLink";
import "./remote.css";
import { PreviewLink } from "../window/previewLink";
import { PROTO } from "../prototype/autoplay287";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the Remote has no root element to render into");
}

// The last input decides whether focus is drawn and revealed (ADR-0037). A
// cut-off first press in a rail only focuses and reveals; the next press
// activates (#245). The rail's native snap is gone, so a minimal reveal is
// not fought by a snap point.
installInputModality(document.documentElement);
installPointerPress(document.documentElement, {
  focusAndReveal: (control) => {
    control.focus({ preventScroll: true });
    control.scrollIntoView({ block: "nearest", inline: "nearest" });
  },
});

/**
 * The served Remote's entry (ADR-0035 §3).
 *
 * One link per page, built here rather than in a render: a render may run twice
 * (StrictMode does), and two links would be two sockets. The socket's URL
 * follows the page's own origin, the Device token lives in the same store the
 * hand-written page used, and the app is handed the one door.
 */
// PROTOTYPE (#287): the rehearsal Host stands in for the socket.
const link = PROTO
  ? new PreviewLink()
  : new WebSocketLink({
      url: socketUrl(window.location),
      tokens: browserTokenStore(),
    });

createRoot(root).render(
  <StrictMode>
    <RemoteApp link={link} />
  </StrictMode>,
);
