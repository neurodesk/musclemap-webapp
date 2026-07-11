#!/usr/bin/env node
// scripts/new-app.mjs
// Scaffold a SELF-CONTAINED app into apps/<name> from templates/app-template.
//
//   pnpm new-app <name>
//
// Revision-1 mistakes fixed:
//   - copies the self-contained templates/app-template (which imports @neurodesk/webapp-components/*
//     by package name), NOT packages/components/templates/* (those import ../../src and break on copy);
//   - the template ships its own package.json, vite.config.js, eslint.config.js, and a test;
//   - fails LOUDLY if a required file is missing instead of silently skipping.
import { cp, readFile, writeFile, access, readdir } from "node:fs/promises";
import { join } from "node:path";

const name = process.argv[2];
if (!name || !/^[a-z][a-z0-9-]*$/.test(name)) {
  console.error("Usage: pnpm new-app <name>   (lowercase kebab-case, e.g. cerebellum)");
  process.exit(1);
}

const root = process.cwd();
const dest = join(root, "apps", name);
const src = join(root, "templates", "app-template");

// Destination must be free.
try {
  await access(dest);
  console.error(`apps/${name} already exists — pick another name.`);
  process.exit(1);
} catch {
  /* free */
}

// Required template files must exist — fail loudly, do not silently skip.
const REQUIRED = [
  "package.json",
  "vite.config.js",
  "eslint.config.js",
  "wrangler.toml",
  "index.html",
  "src/main.js",
];
for (const f of REQUIRED) {
  try {
    await access(join(src, f));
  } catch {
    console.error(`Template is missing required file: ${f} — aborting.`);
    process.exit(1);
  }
}

await cp(src, dest, { recursive: true });

// Stamp APP_NAME into every text file that contains it.
async function stamp(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      await stamp(p);
    } else {
      const text = await readFile(p, "utf8");
      if (text.includes("APP_NAME")) await writeFile(p, text.replaceAll("APP_NAME", name));
    }
  }
}
await stamp(dest);

console.log(`Created apps/${name}. Next:`);
console.log(`  pnpm install`);
console.log(`  pnpm --filter ${name} dev`);
console.log(`CI will install, build, test, and browser-smoke-test this app on your PR.`);
