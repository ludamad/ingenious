import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base` is the GitHub Pages project subpath in production, root in dev.
export default defineConfig(({ command }) => ({
  base: command === "build" ? "/ingenious/" : "/",
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
