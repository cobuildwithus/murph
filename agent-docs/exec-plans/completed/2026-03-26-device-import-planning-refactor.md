# Device Import Planning Refactor

## Goal

Refactor the core device-import write path so `importDeviceBatch` cleanly separates pure batch planning from write execution, and remove duplicated JSONL shard-append planning by reusing one helper from both device import and sample import without changing behavior.

## Constraints

- Preserve current canonical file layout, shard paths, manifest schema, timestamps, deterministic-id logic, dedupe semantics, and sole-raw-artifact fallback behavior.
- Preserve existing validation outcomes and the current error codes/messages for invalid batches, unsupported event/sample kinds, duplicate raw roles, and missing raw-role references.
- Keep the refactor scoped to `packages/core` mutation internals plus focused regression coverage only where needed.

## Planned Files

- `packages/core/src/mutations.ts`
- `packages/core/test/device-import.test.ts`
- `packages/core/test/core.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification

- `pnpm exec vitest run packages/core/test/canonical-mutations-boundary.test.ts packages/core/test/core.test.ts packages/core/test/device-import.test.ts packages/core/test/profile.test.ts packages/core/test/health-bank.test.ts packages/core/test/health-history-family.test.ts --no-coverage --maxWorkers 1 --configLoader runner --config vitest.worker.config.ts` (passed)
- `pnpm typecheck` (fails from pre-existing workspace issues, including unrelated `packages/core/src/bank/providers.ts` and `TS6305` contract/runtime-state build-reference errors)
- `pnpm test:packages` (fails from a sandbox-restricted `tsx` IPC pipe during the root build step after `pnpm no-js` and `packages/contracts` verification pass)
- `node --import tsx/esm e2e/smoke/verify-fixtures.ts` (passed)
- completion workflow audit passes: `simplify` -> `test-coverage-audit` -> `task-finish-review` (manual self-audit; no additional findings)
