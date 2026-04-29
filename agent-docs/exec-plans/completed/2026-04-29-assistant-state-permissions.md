# Assistant State Permissions

## Goal

Make assistant runtime-state permissions a single `runtime-state` storage-boundary policy:

- assistant runtime directories under `.runtime/operations/assistant/**` are `0700`
- assistant runtime files under that tree are `0600`
- hosted bundle restore/materialization applies the same policy while writing restored files
- doctor/audit remains the operator-facing diagnostic and explicit repair path

## Constraints

- Preserve unrelated dirty work in this checkout.
- Keep the change scoped to `packages/runtime-state` plus directly coupled tests/docs unless verification exposes a narrow required caller update.
- Do not rely on process-wide `umask`.
- Do not shell out to `vault-cli assistant doctor` from runtime code.

## Implementation Plan

1. Add an explicit `assistant-state-fs` Node subpath that owns assistant-state write primitives.
2. Update atomic, append, versioned JSON, and hosted restore helpers to use private modes at creation time, with chmod as defense.
3. Make hosted bundle restore apply the internal assistant-state path-derived mode policy for `vault:.runtime/operations/assistant/**`.
4. Add focused tests for private write primitives, permissive-umask restore, artifact materialization, package exports, and audit/repair behavior.
5. Update runtime-state docs for the new boundary.
6. Run scoped verification and required completion reviews.

## Verification

- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/runtime-state test:coverage`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir packages/assistant-runtime test:coverage`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-mailbox-state.test.ts test/hosted-runtime-system-mailbox.test.ts test/hosted-runtime-provider-cleanup.test.ts test/hosted-runtime-workspace-entrypoint.test.ts`
- `pnpm --dir apps/cloudflare runner:bundle`
- `pnpm --dir apps/cloudflare verify`
- Required review passes completed: security/privacy review, coverage-write, simplify review, task-finish review.
- Repo-wide `pnpm typecheck` remains blocked by unrelated dirty Health Commons content schema failures in the checkout.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
