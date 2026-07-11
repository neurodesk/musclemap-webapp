#!/usr/bin/env node
// scripts/new-app.mjs
// Scaffold a new webapp into apps/<name> from a template, pre-wired to the
// shared component library and analytics.
//
//   pnpm new-app <name> [--template basic-segmentation]
//
// Templates come from packages/components/templates/ (basic-segmentation,
// atlas-overlap, multi-echo-qsm-pipeline, step-segmentation-pipeline).
import { cp, readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const name = args.find((a) => !a.startsWith("--"));
const template =
  (args.find((a) => a.startsWith("--template=")) || "").split("=")[1] ||
  "basic-segmentation";

if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("Usage: pnpm new-app <name> [--template=<template>]");
  console.error("  <name> must be lowercase kebab-case, e.g. cerebellum");
  process.exit(1);
}

const root = process.cwd();
const dest = join(root, "apps", name);
const src = join(root, "packages", "components", "templates", template);

try {
  await access(dest);
  console.error(`apps/${name} already exists — pick another name.`);
  process.exit(1);
} catch {
  /* good: destination is free */
}

await cp(src, dest, { recursive: true });

// Stamp the app name into package.json and index.html.
for (const f of ["package.json", "index.html"]) {
  const p = join(dest, f);
  try {
    const text = await readFile(p, "utf8");
    await writeFile(p, text.replaceAll("APP_NAME", name));
  } catch {
    /* file not present in this template — skip */
  }
}

console.log(`Created apps/${name} from template "${template}".`);
console.log("Next:");
console.log(`  pnpm install`);
console.log(`  pnpm --filter ${name} dev`);
