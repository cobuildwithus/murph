# Cloudflare Lazy createRequire

## Goal

Stop Cloudflare Worker validation from tripping over Node-only `createRequire(import.meta.url)` calls at module load time when those modules are present in the bundle but unused in the hosted Worker path.

## Scope

- Make Node-only `createRequire` usage lazy in the offending hosted/runtime modules.
- Re-run the local signals we can exercise safely.
- Push the fix and retry the production Cloudflare deploy workflow.

## Constraints

- Keep the change behavior-preserving for the actual Node-only call sites.
- Preserve unrelated dirty-tree work and active plans.
- Prefer localized lazy initialization over a wider barrel-import refactor unless a later failure proves it is needed.

## Plan

1. Move the top-level `createRequire` calls behind helper functions in the modules surfaced by the deploy error.
2. Re-run safe local checks for the touched files.
3. Commit the fix, push it, and retry the production deploy workflow.
Status: completed
Updated: 2026-04-03
Completed: 2026-04-03
