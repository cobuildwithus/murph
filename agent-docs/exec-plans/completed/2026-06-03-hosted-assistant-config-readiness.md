# Hosted Assistant Config Readiness

## Goal

Make hosted scheduled-wake assistant automation and hosted auto-reply use the same assistant-config preparation primitive, so the scheduled reminder E2E does not lose hosted assistant profile config between bootstrap and readiness checks.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/context.ts`
- `packages/assistant-runtime/src/hosted-runtime/maintenance.ts`
- `packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts`
- Focused assistant-runtime tests and hosted-local scheduled reminder E2E

## Constraints

- Keep the change narrow and composable.
- Do not add a new scheduler, queue, or fallback owner.
- Keep logs redacted and metadata-only.
- Preserve existing direct callers of the automation lane.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --no-coverage test/hosted-runtime-maintenance.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-context.test.ts test/hosted-runtime-context-coverage.test.ts` passed: 4 files, 152 tests.
- `pnpm --dir packages/assistant-runtime exec tsc -p tsconfig.json --pretty false` passed.
- `pnpm hosted-local e2e linq-scheduled-reminder` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-runtime/src/hosted-runtime/context.ts packages/assistant-runtime/src/hosted-runtime/maintenance.ts packages/assistant-runtime/src/hosted-runtime/workspace-assistant-phase.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts packages/assistant-runtime/test/hosted-runtime-workspace-assistant-phase.test.ts` passed.

## Result

Scheduled-wake assistant automation now reuses the readiness state produced by the shared hosted assistant preparation helper. Direct automation-lane callers keep a home-aware read fallback.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
