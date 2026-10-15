import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri's dev server must not pick a port of its own: `devUrl` in
// `src-tauri/tauri.conf.json` names this one.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
});
