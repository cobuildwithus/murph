# Runtime-State SQLite Warning Filter Build Fix

## Goal

Restore the hosted web build by fixing the runtime-state SQLite warning filter import so Next/Turbopack can resolve the workspace source graph used by the device-sync OAuth callback route.

## Why

- Vercel's hosted web build is failing during `next build` with `Module not found: Can't resolve './sqlite-warning-filter.js'`.
- The source tree contains `packages/runtime-state/src/sqlite-warning-filter.ts`, and the workspace generally uses `.ts` source imports for local TypeScript modules.
- `@murphai/runtime-state/node` is consumed directly from source during app builds, so source-level import resolution must work before package dist output exists.

## Scope

- `packages/runtime-state/src/sqlite.ts`
- Verification touching the hosted web/device-sync import path as needed

## Constraints

- Keep the change narrowly scoped to the failing module-resolution seam.
- Preserve unrelated dirty hosted-onboarding work already present in the tree.
- Do not widen public package surfaces or alter runtime behavior beyond fixing source resolution.

## Plan

1. Align the sqlite warning filter import with repo-local TypeScript source import conventions.
2. Run scoped verification for `@murphai/runtime-state` and the hosted web build path that exercised the failure.
3. Complete required review/audit steps, then commit only the plan artifact and touched task files.

## Verification Target

- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/runtime-state test -- sqlite-warning-filter`
- `pnpm --dir apps/web build`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
