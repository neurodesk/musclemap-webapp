#!/usr/bin/env node
// Vendor the shared @neurodesk/webapp-components source into web/vendor/ so the
// static, no-bundler app can resolve the workspace package via the import map in
// index.html. The workspace package remains the single source of truth; web/vendor
// is generated (git-ignored) and refreshed on predev/prebuild.
import { cp, rm, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appRoot = join(here, "..");
const src = join(appRoot, "..", "..", "packages", "components", "src");
const dest = join(appRoot, "web", "vendor", "webapp-components", "src");

try {
  await access(src);
} catch {
  console.error(`Cannot find shared components at ${src} — is this running inside the monorepo?`);
  process.exit(1);
}

await rm(join(appRoot, "web", "vendor"), { recursive: true, force: true });
await cp(src, dest, { recursive: true });
console.log(`Vendored @neurodesk/webapp-components -> web/vendor/webapp-components/src`);
