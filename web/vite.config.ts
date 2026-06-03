import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Relative base so the built assets resolve no matter where the app is mounted:
// the GitHub Pages project subpath (/ingenious/) and the self-hosted server that
// serves the bundle from the root (/) both work.
export default defineConfig(() => ({
  base: "./",
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // only used when self-hosting the optional realtime server in dev
      "/ws": { target: "ws://localhost:8787", ws: true },
      "/api": { target: "http://localhost:8787" },
    },
  },
  optimizeDeps: { exclude: ["ingenious"] },
}));
