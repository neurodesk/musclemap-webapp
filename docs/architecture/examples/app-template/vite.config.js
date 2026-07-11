// Per-app static build. Fully static ./dist, no backend.
// Large ONNX/WASM assets are NOT bundled — they live in public/ or are fetched from
// the model host named in models/<app>.manifest.json.
import { defineConfig } from "vite";

export default defineConfig({
  // Set by the deploy workflow: "/" on Cloudflare (own domain), "/APP_NAME/" on GitHub Pages subpath.
  base: process.env.BASE_PATH || "/",
  build: { target: "es2022", outDir: "dist", assetsInlineLimit: 0 },
  worker: { format: "es" },
  // Dev-server COOP/COEP ONLY. Production isolation comes from public/_headers or the COI SW.
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
});
