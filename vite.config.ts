import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri's dev server must not pick a port of its own: `devUrl` in
// `src-tauri/tauri.conf.json` names this one.
//
// `/host` is the served Remote's socket in development (ADR-0035 §3): the page
// is loaded from this dev server, which is not the Host, so the wire server is
// reached through the one origin the page already has. A production build is
// served by the Host itself and asks its own origin at `/` instead.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    proxy: {
      "/host": {
        target: "http://localhost:8090",
        ws: true,
      },
    },
  },
});
