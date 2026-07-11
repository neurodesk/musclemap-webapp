// apps/<name>/vite.config.js
// Per-app static build. Produces a fully static ./dist with no backend.
// Large ONNX/WASM assets live in public/ (copied as-is, never bundled) or are
// fetched from Hugging Face on demand.
import { defineConfig } from "vite";

export default defineConfig({
  // BASE_PATH is injected by the deploy workflow (e.g. "/musclemap/").
  base: process.env.BASE_PATH || "/",
  build: {
    target: "es2022",
    outDir: "dist",
    // Keep worker + wasm assets addressable at stable paths.
    assetsInlineLimit: 0,
  },
  worker: { format: "es" },
  // COOP/COEP headers so SharedArrayBuffer (ONNX Runtime threads) works in dev.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
