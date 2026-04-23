# Remove the last schema-specific v2 wording from greenfield device-sync tests

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep the device-sync schema at version `1` and remove the remaining schema-specific `v2` wording from the rejection tests so the repo no longer implies a real version-2 schema path for this owner.

## Success criteria

- The greenfield device-sync schema remains version `1`.
- The “reject newer schema” tests use a clearly future sentinel version instead of `2`.
- Focused device-sync tests and repo typecheck pass.

## Scope

- `packages/device-syncd/test/{store,service}.test.ts`
- this plan and the coordination-ledger row for the lane

## Constraints

- Do not touch provider API `/v2/...` paths; those are third-party API versions, not local schema versions.
- Preserve unrelated dirty-tree work.

## Decisions

- The remaining schema-rejection tests now use sentinel user_version `99` instead of `2`, so the repo no longer implies a meaningful local schema v2 path for device-sync.
- Third-party provider `/v2/...` URLs were intentionally left unchanged because they are external API versions, not local schema versions.

## Verification

- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/store.test.ts test/service.test.ts --no-coverage`
- `pnpm typecheck`
- `git diff --check -- packages/device-syncd/test/store.test.ts packages/device-syncd/test/service.test.ts agent-docs/exec-plans/active/2026-04-23-device-sync-schema-wording-followup.md`
- Outcomes:
- Focused `device-syncd` store/service Vitest run passed.
- `git diff --check --` on the task paths passed.
- `pnpm typecheck` failed for an unrelated pre-existing dirty-tree error in [execution.ts](/Users/willhay/startup1/murph/packages/assistant-runtime/src/hosted-runtime/execution.ts:328): `vaultSyncImportResult` is not a known property on `HostedRunDrainMetrics`. This follow-up only touched `packages/device-syncd/test/{store,service}.test.ts`.
Completed: 2026-04-23
