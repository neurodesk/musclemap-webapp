// packages/analytics/src/allowlist.js
// Typed telemetry ALLOW-LIST for patient-data applications.
// Only fields declared here ever leave the browser. Everything else is dropped.
//
// These are STATIC, privacy-preserving neuroimaging apps: images never upload, and
// telemetry must not become a side channel for patient-derived data.

/** Event names are a fixed enum — no free-text event names. */
export const EVENTS = Object.freeze([
  "app_loaded",
  "file_selected",
  "inference_started",
  "inference_succeeded",
  "inference_failed",
  "result_downloaded",
]);

/** Only these property keys may be sent, with these coarse, non-identifying types. */
export const ALLOWED_PROPS = Object.freeze({
  app: "string", // app id, e.g. "musclemap"
  app_version: "string", // e.g. "1.2.37"
  duration_bucket: "enum", // "<1s" | "1-5s" | "5-30s" | ">30s" — never raw timings
  browser_class: "enum", // "chromium" | "firefox" | "safari" | "other"
  os_class: "enum", // "windows" | "macos" | "linux" | "other"
  cross_origin_isolated: "boolean",
  used_gpu: "boolean",
  success: "boolean",
});

/**
 * PROHIBITED — never emitted, never logged, no exceptions:
 * filenames, DICOM metadata/tags, image dimensions, voxel values, any scientific
 * measurement or segmentation, screenshots, free-text logs, patient identifiers.
 */
export const PROHIBITED_SUBSTRINGS = Object.freeze([
  "filename", "path", "patient", "dicom", "voxel", "dim", "shape",
  "measurement", "metric", "segmentation", "screenshot", "log", "note",
]);

/** Sanitize before send: drop unknown/prohibited keys, enforce the enum on event names. */
export function sanitize(event, props = {}) {
  if (!EVENTS.includes(event)) throw new Error(`telemetry: unknown event "${event}"`);
  const out = {};
  for (const [k, v] of Object.entries(props)) {
    const key = k.toLowerCase();
    if (PROHIBITED_SUBSTRINGS.some((s) => key.includes(s))) continue; // never forward
    if (!(k in ALLOWED_PROPS)) continue; // allow-list only
    out[k] = v;
  }
  return { event, props: out };
}

/** track() wraps GA4 send, but every payload passes through sanitize() first. */
export function track(event, props) {
  const clean = sanitize(event, props);
  // ...forward `clean` to GA4. Reporting/aggregation happens server-side via an
  // authenticated scheduled workflow (GA4 Data API), never from this static app.
  return clean;
}
