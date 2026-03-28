# 2026-03-27 Canonical Write Boundary Audit

Status: completed
Created: 2026-03-27
Updated: 2026-03-28

## Goal

- Close any remaining non-core canonical vault write bypasses discovered after the inbox audited-batch fix.
- Add automated coverage so daemon and CLI persistence paths cannot quietly regress back to direct canonical fs writes.

## Success criteria

- Workout-format save no longer writes `bank/workout-formats/*.md` with direct fs calls and instead commits through the audited core write-batch surface.
- Focused regression coverage proves the workout-format save path emits committed write-operation metadata for its canonical text write.
- A repo audit test fails if non-core source files outside the approved exception list start mutating canonical vault paths directly.

## Scope

- `agent-docs/exec-plans/active/{2026-03-27-canonical-write-boundary-audit.md,COORDINATION_LEDGER.md}`
- `packages/cli/src/usecases/workout-format.ts`
- targeted `packages/cli/test/{cli-expansion-workout.test.ts,canonical-write-source-audit.test.ts}`
- `vitest.config.ts`
- `scripts/workspace-verify.sh`

## Constraints

- Preserve existing workout-format CLI behavior and payload shape.
- Do not broaden into a new workout-format core schema while adjacent workout-format work is still dirty in the tree.
- Keep the repo audit narrow enough to allow intentional non-canonical vault writes such as parser-derived artifacts and assistant rollback repair.

## Plan

1. Re-route the workout-format save write through `@murph/core`'s audited batch surface.
2. Add a focused CLI regression proving the saved Markdown now lands through committed `text_write` operation metadata.
3. Add a source-audit test that allowlists the few intentional non-core canonical/raw mutators and fails on new ones.

## Outcome

- `packages/cli/src/usecases/workout-format.ts` now saves workout formats through `applyCanonicalWriteBatch(...)` with a committed `workout_format_save` `text_write` action instead of direct filesystem writes.
- `packages/cli/test/cli-expansion-workout.test.ts` now proves workout-format saves produce committed write-operation metadata and that overwriting an existing format still stays on the audited path.
- `packages/cli/test/canonical-write-source-audit.test.ts` scans non-core source roots for direct canonical/raw vault filesystem mutations and allowlists only the intentional exceptions.
- `vitest.config.ts` and `scripts/workspace-verify.sh` now include the new source-audit regression so it stays on the regular CLI verification path.

## Verification

- `pnpm exec vitest run packages/cli/test/cli-expansion-workout.test.ts packages/cli/test/canonical-write-source-audit.test.ts packages/device-syncd/test/service.test.ts packages/importers/test/device-providers.test.ts --no-coverage --maxWorkers 1` ✅
- `pnpm typecheck` ❌ unrelated existing `packages/contracts/scripts/{generate-json-schema,verify}.ts` module-resolution and implicit-`any` failures in the dirty tree.
- `pnpm test` ❌ unrelated existing `packages/contracts/generated/audit-record.schema.json` drift; the contracts suite reports the generated schema is stale and missing `workout_format_upsert`.
- `pnpm test:coverage` ❌ fails for the same unrelated contracts schema drift.
- `pnpm verify:cli` ❌ progressed into the CLI suite and then hit the pre-existing `packages/cli/test/health-tail.test.ts` failure (`supplement commands expose product metadata and a rolled-up compound ledger`).
Completed: 2026-03-28
