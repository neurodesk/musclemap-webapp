# NeuroDesk Webapps — Architecture & Migration Proposal

**Status:** Proposal · **Date:** 2026-07-11 · **Owner:** @bollmann.steffen

Goal: a maintainable, scalable structure for all NeuroDesk browser webapps that lets us
**reuse components across apps**, makes it **very easy to add a new app**, and treats
**usage statistics** as a shared, built-in concern.

---

## 1. Current state

Five webapps, all built the same way and each in its **own repo**:

| App | Repo | What it does |
| --- | --- | --- |
| MuscleMap | `neurodesk/musclemap-webapp` | Muscle segmentation + fat metrics |
| VesselBoost | `neurodesk/vesselboost-webapp` | Brain vessel segmentation (3D UNet) |
| Spinal Cord Toolbox | `neurodesk/spinalcordtoolbox-webapp` | Spinal cord MRI segmentation |
| CALMaR | `neurodesk/calmar-webapp` | Stroke lesion mapping + connectivity |
| QSM | (plugin present in components) | Quantitative susceptibility mapping |

Shared traits: vanilla-JS ES modules, ONNX Runtime Web (in-browser inference),
NiiVue visualization, "no backend / no upload" privacy model, static GitHub Pages hosting,
Bash `setup.sh`/`run.sh` build scripts.

A shared library **already exists** but is **not yet consumed**:

- `@neurodesk/webapp-components` v0.1.2 (MIT, framework-free ESM).
- Modules: `core/ file-io/ inference/ mask/ pipeline/ ui/ viewer/ volume/`.
- Per-app **plugins**: synthstrip, sct, vesselboost, musclemap, lesion-network-mapping, qsm.
- **Templates**: basic-segmentation, atlas-overlap, multi-echo-qsm-pipeline, step-segmentation-pipeline.
- Has a showcase + tests.

**The core problem is adoption, not extraction.** `musclemap-webapp` has no `package.json`
and zero references to `webapp-components`; CALMaR and SCT don't reference it either.
The right code was factored out, but the apps still ship their own copies.

---

## 2. Options considered

| Approach | Reuse | Add an app | Independent deploy | Cross-app change | Verdict |
| --- | --- | --- | --- | --- | --- |
| Branch-per-app in one repo | ✗ can't import across branches | painful | ✗ | merge hell | reject |
| Git submodules for components | ⚠️ pinned SHAs, 2-step commits | ceremony | ✓ | two repos in lockstep | reject |
| Polyrepo + published npm lib | ✓ but publish→bump→update loop | new repo each time | ✓ | multi-repo, versioned | acceptable |
| **Monorepo + workspaces** | ✓ live local imports | ✓ scaffold a folder | ✓ CI matrix | ✓ atomic, one PR | **recommended** |

### Why not branch-per-app
Git branches model *versions of one thing over time*, not *parallel products*. You'd lose
per-app issues/PRs/releases/deploys, every shared-component change becomes a cross-branch
cherry-pick, and branches can't `import` from each other so there's no real sharing.

### Why not submodules
Submodules pin a commit SHA, so contributors must remember `git submodule update`; a component
change needs two lockstep commits in two repos; detached-HEAD states trap people; Pages/CI builds
get fiddly. They're for vendoring a foreign codebase, not a library you control and could just import.

---

## 3. Recommended architecture: monorepo with workspaces

Keep the (correct) instinct to extract shared code into a package — but consume it as an
**internal workspace package** so there's no publish/version friction between the library and the apps.

```
neurodesk-webapps/                     (one repo)
├── packages/
│   └── components/                    @neurodesk/webapp-components  (the existing lib, moved in)
├── apps/
│   ├── musclemap/                     imports @neurodesk/webapp-components
│   ├── vesselboost/
│   ├── spinalcordtoolbox/
│   ├── calmar/
│   ├── qsm/
│   └── stats/                         cross-app usage dashboard
├── templates/                         scaffolds consumed by the "new app" generator
├── scripts/new-app.mjs                pnpm new-app <name>
├── .github/workflows/
│   ├── ci.yml                         lint + test the whole graph on every PR
│   └── deploy.yml                     matrix: build+deploy each app to its own Pages
├── pnpm-workspace.yaml
├── turbo.json                         task graph + caching
└── package.json                       workspaces + changesets
```

### How this meets each goal

- **Reuse** — apps `import { createNeuroWebapp, ProgressManager } from '@neurodesk/webapp-components'`.
  In a workspace this resolves to local source via a symlink, so edits to a component and all
  consuming apps land in the **same PR** (atomic). CI builds the component + every app together,
  so an app can't be silently broken.
- **Easy to add an app** — `pnpm new-app <name>` copies a template into `apps/`, wires the shared
  library, and the deploy matrix picks it up automatically. Adding an app is a folder, not a repo
  provisioning ceremony.
- **Statistics built in** — analytics live in the library (`components/analytics`, wrapping the
  Neurodesk GA4 setup already in musclemap commit `13809d6`) so every app emits consistent events
  by construction. `apps/stats` is then just another app that visualizes cross-app usage. A new app
  gets analytics for free.

### Independent GitHub Pages deploys still work
A CI **matrix** builds each `apps/*` and publishes to its own Pages target (separate repo-pages or
subpaths of one site). Independent deploys without independent repos. See `examples/deploy.yml`.

### Versioning
Use [Changesets](https://github.com/changesets/changesets). Internally apps track the library live;
if we ever want external consumers, Changesets publishes `@neurodesk/webapp-components` to npm on
release. Both worlds covered.

### Tooling choice
- **pnpm workspaces** for linking (fast, strict, disk-efficient — matters given large ONNX/WASM assets).
- **Turborepo** for the task graph + remote caching so CI only rebuilds what changed.
- **Vite** per app (dev server + build) replacing the ad-hoc `setup.sh`/`run.sh`, while keeping the
  static-output / no-backend guarantee. Large model/wasm assets stay outside the bundle (served as
  static files or fetched from Hugging Face on demand, as CALMaR already does).

---

## 4. The one honest tradeoff

The five repos have their own issues, stars, and release history, and there's a published package.
A monorepo consolidates all that: archive the old repos with a pointer to the monorepo, migrate
history with `git subtree`/`git-filter-repo` (see §6). If preserving separate repo identities matters
more than atomic cross-app changes, the fallback is **finish polyrepo adoption**: make each app depend
on the *published* `@neurodesk/webapp-components` via npm + import maps. Less disruptive, but it
reintroduces the publish→bump→update loop on every shared change — exactly the friction that stalled
adoption the first time. For a small team optimizing reuse + easy-add + shared stats, the monorepo
consolidation is a one-time cost vs. a forever tax.

---

## 5. Concrete artifacts (ready to use)

All files below are provided under [`examples/`](./examples/) so they can be copied straight into the
new repo:

- [`examples/pnpm-workspace.yaml`](./examples/pnpm-workspace.yaml)
- [`examples/root-package.json`](./examples/root-package.json)
- [`examples/turbo.json`](./examples/turbo.json)
- [`examples/deploy.yml`](./examples/deploy.yml) — per-app Pages deploy matrix
- [`examples/ci.yml`](./examples/ci.yml) — lint + test the graph
- [`examples/new-app.mjs`](./examples/new-app.mjs) — `pnpm new-app <name>` generator
- [`examples/app-vite.config.js`](./examples/app-vite.config.js) — per-app static build config
- [`examples/app-package.json`](./examples/app-package.json) — template app manifest

---

## 6. Migration plan

### Phase 0 — Stand up the monorepo (½ day)
1. Create `neurodesk/neurodesk-webapps`.
2. Add root files from §5 (`pnpm-workspace.yaml`, `package.json`, `turbo.json`, CI workflows).
3. Move `webapp-components` in with history:
   `git subtree add --prefix=packages/components https://github.com/neurodesk/webapp-components main`
   (or `git-filter-repo` into `packages/components/`). Keep the package name `@neurodesk/webapp-components`.

### Phase 1 — Migrate MuscleMap as the reference app (1–2 days)
This repo/branch is where that work is prototyped. Checklist:
1. `git subtree`/`filter-repo` `musclemap-webapp` `web/` into `apps/musclemap/`.
2. Add `apps/musclemap/package.json` depending on `"@neurodesk/webapp-components": "workspace:*"`.
3. Replace duplicated modules with imports. Current duplication to delete in favor of the library:
   - `web/js/modules/ui/*` (`ProgressManager`, `ConsoleOutput`, `ModalManager`, `MetricsSummary`, `MuscleLegend`) → `@neurodesk/webapp-components/ui`
   - `web/js/modules/file-io/NiftiUtils.js`, `web/dcm2niix/*`, `web/nifti-js/*` → `.../file-io`
   - `web/js/modules/inference/*` (`preprocessing`, `postprocessing`, `sliding-window`, `connected-components`) + `web/js/inference-worker.js` → `.../inference`
   - `web/js/controllers/*` (`ViewerController`, `FileIOController`, `DicomController`, `InferenceExecutor`) → the `core` app shell / `viewer`
   - App-specific bits (`web/js/app/labels.js`, `web/js/app/config.js`, `web/models/*.onnx`) stay in `apps/musclemap/`, wired through the `musclemap` plugin.
4. Move analytics (`tests/test_analytics.py` behavior + GA4 from commit `13809d6`) to `components/analytics`; app just calls `trackEvent(...)`.
5. Swap `setup.sh`/`run.sh` for `vite` (`apps/app-vite.config.js`). Verify the built `dist/` is fully static and inference still runs in-browser.
6. Port `.github/workflows/{release,deploy-pages}.yml` into the monorepo deploy matrix.
7. Confirm parity: same models, same outputs, `scripts/compare_inference.py` still passes.

### Phase 2 — Migrate the rest (per app, ~1 day each)
Repeat Phase 1 for vesselboost, spinalcordtoolbox, calmar, qsm. Each reuses more of the library, so
each migration is smaller than the last. VesselBoost's `rust-preprocessing/` becomes a shared
`packages/` WASM package if other apps want it.

### Phase 3 — Statistics app (1–2 days)
`apps/stats` reads the shared GA4 stream and renders a cross-app usage dashboard (runs, per-app volume,
model timings). Because analytics is centralized, coverage is automatic for every current and future app.

### Phase 4 — Deprecate old repos
Archive each source repo with a README pointer to the monorepo. Redirect Pages or keep old URLs live
until the monorepo deploys are verified.

### Adding a *new* app after migration
```
pnpm new-app cerebellum      # scaffolds apps/cerebellum from a template, wired to the lib + analytics
pnpm --filter cerebellum dev # local dev
# open a PR — CI tests it, deploy matrix publishes it to Pages
```

---

## 7. Open decisions for @bollmann.steffen

1. **Direction** — monorepo (recommended) vs. finish polyrepo adoption?
2. **Pages layout** — one site with per-app subpaths (`neurodesk.github.io/webapps/musclemap`) vs.
   keep per-app Pages sites/domains?
3. **Preserve old repos** — archive-with-pointer, or keep them as thin mirrors?
4. **Bundler** — adopt Vite (recommended) or keep the current script-based static serving?
