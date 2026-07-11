// Scaffolded entry point. Imports the SHARED library by package name (resolved via
// pnpm workspace) — NOT a relative ../../src path — so the copy is self-contained.
import { createNeuroWebapp, ProgressManager, ConsoleOutput } from "@neurodesk/webapp-components";
import { track } from "@neurodesk/analytics"; // typed allow-list emitter (see telemetry-allowlist.js)

const app = createNeuroWebapp({
  root: document.getElementById("app"),
  ui: { progress: new ProgressManager(), console: new ConsoleOutput() },
  // App-specific scientific worker, metric renderers, and pipeline definitions live in THIS app,
  // not in the shared library. Wire them here.
});

track("app_loaded", { app: "APP_NAME" });

export default app;
