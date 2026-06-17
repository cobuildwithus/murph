# PR 182 Latency Simplification

## Goal

Simplify PR 182 before landing by centralizing hosted latency `phaseBreakdown`
schema/merge/sanitize behavior in the shared hosted-execution owner, leaving the
runtime wake diagnostics behavior unchanged.

## Scope

- `packages/hosted-execution/src/runtime-control.ts`
- `packages/hosted-execution/src/parsers/runtime-control.ts`
- `packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `apps/web/src/lib/hosted-runtime-latency/store.ts`
- `apps/web/test/hosted-runtime-latency-store.test.ts`

## Invariants

- Diagnostics stay metadata-only and non-blocking.
- Web keeps DB locking/persistence ownership; hosted-execution owns shared
  diagnostic contract helpers.
- Do not change runtime wake propagation semantics in this simplification pass.
- Preserve idempotent leaf merging and stale stored diagnostic cleanup.

## Verification Plan

- `pnpm --dir packages/hosted-execution test -- test/hosted-runtime-control.test.ts`
- `pnpm exec vitest run apps/web/test/hosted-runtime-latency-store.test.ts --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-store-config`
- `pnpm typecheck`

## Verification

- `pnpm --dir packages/hosted-execution test -- test/hosted-runtime-control.test.ts` passed.
- `pnpm exec vitest run apps/web/test/hosted-runtime-latency-store.test.ts --config apps/web/vitest.workspace.ts --no-coverage --project hosted-web-store-config` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.

## Audits

- `security-privacy-review`: no findings.
- `coverage-write`: no findings; coverage adequate.
- `deep-review`: no production-breaking findings; helper API narrowed so callers cannot request cleanup-only writes with null incoming diagnostics.

## State

Done; ready for `scripts/finish-task`.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
