# Cloudflare Deploy Script Path Resolution

## Goal

Make the Cloudflare deploy scripts resolve workspace packages from source on clean GitHub runners instead of falling back to missing `dist/` entrypoints.

## Scope

- Align `apps/cloudflare/tsconfig.scripts.json` with the canonical repo workspace alias map.
- Re-run the local deploy-config render and other focused signals available in this workspace.
- Re-dispatch the production Cloudflare deploy workflow after the fix is pushed.

## Constraints

- Keep the change limited to TypeScript/tsx workspace resolution; no behavior changes.
- Preserve unrelated dirty-tree work and active plans.
- Prefer the repo's canonical path map over another partial copy.

## Plan

1. Remove or replace the stale partial path override in `apps/cloudflare/tsconfig.scripts.json`.
2. Re-run the local deploy-config render and focused checks that exercise the same path.
3. Commit the fix, push it, and retry the production deploy workflow.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
