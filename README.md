# NeuroDesk Webapps (monorepo)

Static, privacy-preserving, in-browser neuroimaging webapps and their shared components, in one
repository. All processing happens client-side — no data is uploaded.

> **Status: structural consolidation in progress.** The apps below were imported from their original
> repositories into this monorepo layout. They are **not yet converted** to the shared build/workspace
> contract — that happens per app, behind parity tests (see the RFC). Until an app is converted it
> still runs via its own `web/` + `setup.sh`/`run.sh` as before.

## Layout

```
apps/
  musclemap/            muscle segmentation + fat metrics (IMF/Dixon/CSV)
  vesselboost/          brain vessel segmentation (3D UNet) + Rust/WASM preproc
  spinalcordtoolbox/    spinal cord MRI segmentation
  calmar/               stroke lesion mapping + functional connectivity
packages/
  components/           @neurodesk/webapp-components — shared framework-free ESM library
  analytics/            @neurodesk/analytics — value-validating telemetry allow-list (consent + DNT)
templates/app-template/ self-contained scaffold used by `pnpm new-app`
registry/apps.yml       source of truth: app id · domain · Cloudflare project · GA4 id · model manifest
models/                 externalized model manifests (url · sha256 · size · license · preproc contract)
scripts/new-app.mjs     `pnpm new-app <name>`
docs/architecture/      the architecture RFC + validated example configs
```

## How it fits together

- **Reuse:** apps consume `@neurodesk/webapp-components` as an internal `workspace:*` package, so a
  component change and its consumers land in one atomic PR.
- **Add an app:** `pnpm new-app <name>` scaffolds a self-contained app and registers it in
  `registry/apps.yml`.
- **Deploy:** each app is its own **Cloudflare Pages** project (Direct Upload from CI); `main` →
  staging previews, per-app tag `<app>-v*` → production. Keeps each `*.neurodesk.org` domain.
- **Statistics:** GA4 → authenticated scheduled workflow → sanitized aggregate JSON → static stats app.
  Telemetry validates values and prohibits patient-derived data.

See [`docs/architecture/webapps-monorepo-proposal.md`](docs/architecture/webapps-monorepo-proposal.md)
for the full rationale, the shared/app boundary, and the migration plan.

## Status: all four org apps wired and installable

- **`pnpm install` works** across the whole workspace (7 projects); the lockfile is committed.
- **All four apps are workspace packages** (`musclemap`, `vesselboost`, `spinalcordtoolbox`, `calmar`),
  each depending on `@neurodesk/webapp-components`, with consistent scripts
  (`vendor`/`dev`/`build`/`test:e2e`), a native-ESM **import map**, production `_headers`, and a
  `wrangler.toml`. Shared `vendor`/`build` logic lives in `scripts/`.
- **Wiring is proven in a real browser** for every app: a Playwright harness asserts the import map
  resolves `@neurodesk/webapp-components` in Chromium (`apps/*/e2e/`).
- **CI is active** (`.github/workflows/ci.yml`): `turbo run lint`, light unit tests (MuscleMap parity,
  analytics allow-list), and the per-app browser smoke matrix.
- **First real extraction (MuscleMap pilot):** `ProgressManager` now comes from the shared library,
  behind a **parity test** (`apps/musclemap/test/ui-progress-parity.test.js`, shared ≡ archived
  original). The interim wiring is a native-ESM import map + a vendored copy of the library, which
  **preserves the classic `importScripts` inference worker and relative asset paths untouched** — no
  bundler cutover, no worker migration.

## Not yet done (tracked follow-ups)

- Extract more Tier-1 components (ConsoleOutput, ModalManager, DICOM→NIfTI, NIfTI utils) the same way,
  each behind a parity test; MuscleMap's `ConsoleOutput`/`ModalManager` have **drifted** from the
  library and need reconciliation, not a blind swap. So far only `ProgressManager` is extracted; the
  other apps have the wiring in place but still use their own local modules.
- Run each app's own heavy test suite in CI (needs fixtures + `onnxruntime-node` native build).
- **Cloudflare deploy** (`docs/architecture/examples/deploy.cloudflare.yml`) activates once the
  Pages projects and `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` secrets exist.
- Optionally convert apps to a Vite bundle (must keep the classic worker working); externalize model
  binaries to the `models/` manifests.
- Collaborator-owned apps (QSMbly, SeedSeg, dicompare) join after a licensing/ownership agreement.
