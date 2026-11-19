import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite serves the app on :3000 and proxies /api to the local API server (:8787).
// Prod: `npm run build` emits dist/ and `npm start` serves dist/ + /api from one process.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [{ find: "@", replacement: path.resolve(import.meta.dirname, "./src") }],
  },
  server: {
    host: true,
    port: 3000,
    // Set this to the preview hostname when serving through a tunnel/proxy.
    allowedHosts: process.env.VITE_ALLOWED_HOSTS
      ? process.env.VITE_ALLOWED_HOSTS.split(",").map((h) => h.trim()).filter(Boolean)
      : undefined,
    proxy: {
      "/api": {
        target: process.env.API_URL || "http://localhost:8787",
        changeOrigin: true,
      },
    },
  },
});
