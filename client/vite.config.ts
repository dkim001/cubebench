import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev server proxies /api and the health probes to the Express backend so the
// browser only ever talks to one origin (no CORS friction in dev).
//
// cubing.js: excluded from dependency pre-bundling (it uses top-level await
// and its own worker files, which esbuild's es2020 prebundle target rejects) —
// Vite serves its native ESM directly. Build target raised to es2022 to match.
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["cubing"],
  },
  build: {
    target: "es2022",
  },
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:4000", changeOrigin: true },
      "/ready": { target: "http://localhost:4000", changeOrigin: true },
      "/health": { target: "http://localhost:4000", changeOrigin: true },
    },
  },
});
