# Runtime-State Hosted Subpaths

## Goal

Stop hosted code from pulling SQLite through the broad `@murphai/runtime-state/node` barrel by introducing narrower Node-only subpaths for the specific helpers used by `apps/web` and the hosted-safe parts of `device-syncd`.

## Why

- `@murphai/runtime-state/node` currently re-exports `sqlite.ts`, so any hosted import of that barrel evaluates the SQLite module.
- `apps/web` and the hosted-facing parts of `device-syncd` only need non-SQLite helpers such as warning filters, assistant-usage parsing, runtime path constants, ULID helpers, and loopback bearer parsing.
- Narrower subpaths let hosted code depend on the intended helper owners without forcing a new package or dragging the SQLite seam into the Next.js build graph.

## Scope

- `packages/runtime-state/package.json`
- `packages/runtime-state/src/node/**`
- `packages/runtime-state/test/package-boundary.test.ts`
- `packages/runtime-state/README.md`
- `packages/device-syncd/src/shared.ts`
- `packages/device-syncd/src/http.ts`
- `apps/web/src/lib/process-warnings.ts`
- `apps/web/src/lib/hosted-execution/usage.ts`

## Constraints

- Keep the existing `@murphai/runtime-state/node` barrel for compatibility.
- Do not widen the hosted-onboarding lane already in progress.
- Avoid introducing a new package unless the narrower subpath split proves insufficient.

## Plan

1. Add explicit `runtime-state` Node subpaths for the non-SQLite helpers used by hosted code.
2. Rewrite hosted-facing imports in `apps/web` and `device-syncd` to use those narrow subpaths.
3. Update package-boundary coverage and package docs so the new seams are explicit.
4. Run scoped verification, including the hosted web build, and commit only the task files.

## Verification Target

- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/runtime-state test:coverage`
- `pnpm --dir packages/device-syncd typecheck`
- `pnpm --dir apps/web build`
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
