/*
 * Build the one asset the served Remote fetches outside its own document:
 * Motion's vanilla `animate`, as a version-pinned ESM bundle.
 *
 * The page itself still builds nothing at serve time. This script is the
 * developer step that regenerates the committed file after a Motion upgrade;
 * `host-wire` serves the file from `crates/host-wire/remote/` at a versioned,
 * immutable URL (ADR-0031 §1).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { build } from "vite";

const root = fileURLToPath(new URL("..", import.meta.url));
const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const version = String(pkg.dependencies.motion).replace(/^[^\d]*/, "");
if (!/^\d+\.\d+\.\d+/.test(version)) {
  throw new Error(`package.json does not name a Motion version: ${pkg.dependencies.motion}`);
}

await build({
  configFile: false,
  root,
  logLevel: "warn",
  // The bundle is the only output; the window's `public/` must not be copied
  // into the served Remote's directory.
  publicDir: false,
  build: {
    target: "es2022",
    minify: true,
    emptyOutDir: false,
    lib: {
      entry: resolve(root, "scripts/remote-motion-entry.js"),
      formats: ["es"],
      fileName: () => `motion-${version}.js`,
    },
    outDir: "crates/host-wire/remote",
    rollupOptions: {
      output: {
        banner:
          `/*! Motion v${version} | MIT | ` +
          "https://github.com/motiondivision/motion | vendored for the served Remote (ADR-0031). */",
      },
    },
  },
});
