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

## Not yet done (tracked follow-ups)

- Convert each app to a Vite workspace package (`build`/`dev`/`test`), starting with MuscleMap behind
  parity tests; replace per-app `setup.sh`/`run.sh`.
- Activate the monorepo CI + Cloudflare deploy workflows (kept under `docs/architecture/examples/`
  until the Cloudflare projects and secrets exist).
- Externalize model binaries to the manifests in `models/` (they are currently still committed inside
  each app's `web/models/` as in the original repos).
- Collaborator-owned apps (QSMbly, SeedSeg, dicompare) join after a licensing/ownership agreement.
