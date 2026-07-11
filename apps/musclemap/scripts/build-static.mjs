#!/usr/bin/env node
// "Build" for the not-yet-bundled MuscleMap app: assemble a static, deployable dir.
// This is intentionally minimal — MuscleMap is still native-ESM (no bundler), so the
// deployable IS web/ with vendored components + downloaded ORT wasm (see prebuild).
// Full Vite bundling is a later step; the classic importScripts worker must be
// preserved when that happens.
import { cp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const web = join(appRoot, "web");
const dist = join(appRoot, "dist");

await rm(dist, { recursive: true, force: true });
// Copy the static site (includes vendor/ and wasm/ produced by prebuild).
await cp(web, dist, { recursive: true });
console.log("Assembled static site -> apps/musclemap/dist");
