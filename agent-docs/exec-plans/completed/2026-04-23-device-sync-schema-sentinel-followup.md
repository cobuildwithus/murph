# Replace the device-sync schema rejection test sentinel with a derived future version

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep the greenfield device-sync schema at version `1` while replacing the hardcoded rejection-test sentinel with a value derived from the supported schema constant.

## Success criteria

- The device-sync rejection tests no longer hardcode `99`.
- The tests derive the unsupported future schema version from `DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION + 1`.
- Focused device-sync tests pass, and repo typecheck is rerun with any unrelated blocker called out.

## Scope

- `packages/device-syncd/test/{store,service}.test.ts`
- this plan and the coordination-ledger row for the lane

## Constraints

- Do not change the actual schema version or replay-fence logic.
- Preserve unrelated dirty-tree work.

## Decisions

- The unsupported future schema version in the rejection tests is derived from `DEVICE_SYNC_STORE_SQLITE_SCHEMA_VERSION + 1` instead of a hardcoded sentinel.
- No runtime schema, replay-fence, or migration behavior changed in this follow-up.

## Verification

- Passed: `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts test/store.test.ts test/service.test.ts --no-coverage`
- Passed: `pnpm typecheck`
- Passed: `git diff --check -- packages/device-syncd/test/store.test.ts packages/device-syncd/test/service.test.ts agent-docs/exec-plans/active/2026-04-23-device-sync-schema-sentinel-followup.md`
Completed: 2026-04-23
