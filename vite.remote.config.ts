import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

import { ACTION_VERSION } from "./src/core/wire";
import { REMOTE_ACTIONS } from "./src/remote/actions";

/**
 * The Remote's build (ADR-0035 §3).
 *
 * A second entry of the same tree, not a second package: `remote.html` and the
 * React Remote behind it build into `crates/host-wire/remote/`, which is
 * committed and compiled into the binary. Nothing here is built at serve time,
 * and no asset comes from a network.
 *
 * `base: "/"` is the page's real home: the Host serves the document at `/` and
 * every asset URL the document names is rooted there, so the hashed assets are
 * `/assets/<name>`. `publicDir: false` keeps the token sheet's root-absolute
 * `/fonts/<name>` URLs pointing at the Host's existing route instead of being
 * copied into this bundle.
 */

/**
 * The build's own metadata, written beside the bundle.
 *
 * It carries the wire version and the Action spellings, and it is deterministic:
 * no timestamp, no SHA, no absolute path, no locale. `host-wire`'s test reads it
 * out of the embedded artifact and holds it to `Action::SPELLINGS` and
 * `ACTION_VERSION`, so a capability added on one side cannot pass (ADR-0035 §3).
 */
function buildInfo(): Plugin {
  return {
    name: "remote-build-info",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: `${JSON.stringify(
          { wireVersion: ACTION_VERSION, actions: REMOTE_ACTIONS },
          null,
          2,
        )}\n`,
      });
    },
  };
}

export default defineConfig({
  base: "/",
  publicDir: false,
  plugins: [react(), buildInfo()],
  build: {
    outDir: "crates/host-wire/remote",
    // The output lives outside this project's root, so Vite would otherwise
    // leave whatever a previous build wrote beside the new files.
    emptyOutDir: true,
    // The page is the entry; the assets beside it are named for their contents,
    // so the Host can serve them `immutable` and a new build is a new URL.
    rollupOptions: {
      input: "remote.html",
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
    // The bundled dependencies' notices travel with the bundle, beside the
    // page, and are never served: the Host answers them 404 (ADR-0035 §3).
    license: { fileName: "licenses.md" },
  },
});
