import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import { DesignKitPrototype } from "./prototype/DesignKitPrototype";
import "./styles.css";

const root = document.getElementById("root");
if (!root) {
  throw new Error("the window has no root element to render into");
}

const search = new URLSearchParams(window.location.search);
const showDesignKitPrototype =
  import.meta.env.DEV &&
  (search.has("variant") || search.get("prototype") === "kit");

createRoot(root).render(
  <StrictMode>
    {showDesignKitPrototype ? <DesignKitPrototype /> : <App />}
  </StrictMode>,
);
