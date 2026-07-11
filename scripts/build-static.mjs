#!/usr/bin/env node
// Shared "build" for the not-yet-bundled native-ESM apps: assemble a static,
// deployable dir. The deployable IS web/ with vendored components + downloaded ORT
// wasm (produced by the app's prebuild). Full Vite bundling is a later step and must
// preserve the classic importScripts inference worker.
//
// Run via each app's `build` script: `node ../../scripts/build-static.mjs`.
import { cp, rm } from "node:fs/promises";
import { join } from "node:path";

const appDir = process.env.INIT_CWD || process.cwd();
const web = join(appDir, "web");
const dist = join(appDir, "dist");

await rm(dist, { recursive: true, force: true });
await cp(web, dist, { recursive: true });
console.log(`Assembled static site -> ${join(appDir, "dist")}`);
