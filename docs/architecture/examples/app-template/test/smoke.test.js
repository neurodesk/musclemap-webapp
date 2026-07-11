// Minimal unit smoke test so a freshly scaffolded app has a passing `test` task
// (CI also runs a browser smoke test that asserts crossOriginIsolated + worker load).
import { test } from "node:test";
import assert from "node:assert/strict";

test("app module imports without throwing", async () => {
  const mod = await import("../src/main.js");
  assert.ok(mod.default, "app should export a default instance");
});
