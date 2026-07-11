# Preferred deploy: Cloudflare Pages, one project per app, from one monorepo

Cloudflare Pages supports **multiple projects backed by the same repository**, so each app deploys
independently and keeps its own `*.neurodesk.org` custom domain. This avoids the GitHub Pages
single-site race entirely (revision 1's `deploy.yml` ran `deploy-pages` once per app against one
Pages site — the jobs overwrote each other).

## Per-app project settings (in the Cloudflare dashboard or via API)

For each app, create a Pages project connected to `neurodesk/neurodesk-webapps`:

| Setting | Value (musclemap example) |
| --- | --- |
| Production branch | `main` |
| Root directory (advanced) | `apps/musclemap` |
| Build command | `pnpm exec turbo run build --filter=musclemap` |
| Build output directory | `apps/musclemap/dist` |
| Build watch paths | `apps/musclemap/**`, `packages/components/**`, `packages/analytics/**` |
| Custom domain | `musclemap.neurodesk.org` |

**Build watch paths** ensure a project only rebuilds when that app or a dependency it uses changes —
push to `apps/calmar` does not redeploy MuscleMap. Point the build command at Turbo (not raw
`pnpm --filter … build`) so caching and task dependencies apply.

## Staging vs production

- **Preview deployments**: every PR / non-production branch gets a Cloudflare preview URL per project.
- **Production**: pushes to `main` publish the production deployment for changed projects; if you want
  tag-gated production, disable auto-production on `main` and trigger via the Cloudflare deploy API
  from a per-app tag workflow (`musclemap-v*`), keeping `main` as staging.

## Cross-origin isolation in production

Ship [`_headers`](./_headers) at each app's output root **or** include the COI service worker
(`coi-serviceworker.js`, already in MuscleMap). Cloudflare serves `_headers` on the CDN edge, which
is the cleaner option. Verify with the deployed `crossOriginIsolated` smoke test.
