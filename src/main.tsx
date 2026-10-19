import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the window has no root element to render into");
}

const app = createRoot(root);

/**
 * Choose the client at build time.
 *
 * `VITE_SHELL=next` builds the new ten-foot shell; every other build loads the
 * shipping `App.tsx` exactly as before. Both imports are dynamic so Vite can
 * fold the flag and leave the other tree out of the bundle entirely.
 */
async function start() {
  if (import.meta.env.VITE_SHELL === "next") {
    const { Shell } = await import("./shell");
    app.render(
      <StrictMode>
        <Shell />
      </StrictMode>,
    );
    return;
  }

  const [{ App }] = await Promise.all([import("./App"), import("./styles.css")]);
  app.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
