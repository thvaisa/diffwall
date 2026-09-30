import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Web app lives in web/, builds to dist/web (served by the node server in prod).
// In dev, Vite serves web/ and proxies /api to the node server on :7777.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "../dist/web",
    emptyOutDir: true,
    target: "es2022",
    // mermaid's per-diagram-type chunks (lazy-loaded on demand, not part of
    // the initial bundle) routinely exceed Vite's default 500kB warning.
    chunkSizeWarningLimit: 1000,
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:7777",
    },
  },
});
