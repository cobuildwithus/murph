# Reject contradictory automation schedule flags

Status: completed
Created: 2026-08-30
Updated: 2026-08-30

## Outcome

`automation save` and schedule-changing `automation edit` reject contradictory
canonical/legacy aliases and schedule fields that do not belong to the selected
trigger kind. Errors remain machine-readable, point to the exact public
`schedule.*` field, and never echo submitted values. Valid legacy aliases,
matching duplicate aliases, cron expressions, and timezones retain their
existing behavior.

## Reaches

- Shared typed schedule construction for `automation save` and `automation edit`.
- Validation envelopes for trigger kind, timestamp, interval, cron, local-time,
  timezone, and device-activity schedule options.
- Focused CLI regression proof for rejected creates and rejected edits.
- No changes to structured `automation import-json`, stored automation schemas,
  query behavior, or runtime scheduling.

## Invariants

- Validation completes before `upsertAutomation` or `patchAutomation` receives
  an invalid typed schedule.
- Error messages name public option flags only; submitted schedule,
  instructions, and route values are not projected.
- Each rejected field maps to its canonical public schedule path.
- Matching canonical and legacy values continue to resolve to one stored value.

## Proof

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts
  --no-coverage packages/cli/test/automation.test.ts`: 1 file and 35 tests
  passed.
- `pnpm --dir packages/cli typecheck`: passed with the package TypeScript
  checker.
- The regression proves three rejected saves leave an empty automation list,
  then proves an invalid edit leaves the original cron expression, timezone,
  and instructions unchanged.
- The same regression verifies `invalid_option`, non-retryable validation-stage
  envelopes, exact public field paths, and omission of submitted private values.

## Progress

- [x] Reproduced silent acceptance of conflicting aliases and irrelevant fields.
- [x] Added owner-local validation in the shared typed schedule builder.
- [x] Added focused safe-envelope, no-create, and unchanged-edit regression proof.
- [x] Run focused tests and package typecheck, then record the results.
Completed: 2026-08-30
