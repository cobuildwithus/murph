# Vault-Local Automation Timezones And Unified Recurring Scheduling

## Goal

Hard-cut recurring assistant automations to the vault's current timezone, remove timezone-bearing recurring schedule state from canonical automation docs, and simplify recurring scheduling so timezone changes retime recurring automations automatically without a separate reconcile pass.

## Why

- Canonical automation docs currently persist `schedule.timeZone`, which freezes recurring reminders to the timezone in effect when the automation was created instead of following the vault's current timezone.
- Assistant cron runtime state currently persists `nextRunAt` as both the logical scheduled occurrence and the retry/wake cursor, which makes timezone changes sticky and obscures scheduler behavior.
- Recurring food auto-log still materializes a separate local cron job lane even though the product intent is the same recurring local-time behavior.
- The clean long-term architecture is one recurring scheduler model: canonical schedule intent plus vault-local timezone resolution plus runtime residue only.

## Scope

- `packages/contracts/src/automation.ts`
- `packages/core/src/automation.ts`
- `packages/query/src/automation.ts`
- `packages/operator-config/src/assistant-cli-contracts.ts`
- `packages/assistant-engine/src/assistant/cron*.ts`
- `packages/assistant-engine/src/assistant/automation/run-loop.ts`
- `packages/assistant-engine/src/assistant/food-auto-log-hooks.ts`
- `packages/vault-usecases/src/usecases/food-autolog.ts`
- focused tests under `packages/contracts/test/**`, `packages/core/test/**`, `packages/query/test/**`, `packages/assistant-engine/test/**`, and `packages/cli/test/**`
- matching durable architecture/contract docs

## Constraints

- Favor one clean architecture cut over additive reconciliation logic.
- Recurring schedules should follow the current vault timezone by product default; do not preserve a foreign-timezone pinning mode.
- Keep canonical automation docs as the user-facing source of recurring schedule intent.
- Keep runtime state limited to execution residue and retry bookkeeping.
- Preserve unrelated dirty worktree edits.

## Plan

1. Update canonical automation contracts and read/write helpers so recurring schedules no longer require or persist `timeZone`, while backward reads still accept legacy timezone-bearing records.
2. Refactor assistant cron scheduling so canonical recurring jobs resolve their effective timezone from the vault at projection time and runtime state no longer treats persisted `nextRunAt` as schedule truth.
3. Fold recurring food auto-log onto the same canonical recurring scheduler path instead of keeping a separate local cron materialization lane.
4. Update tests and durable docs to reflect vault-local recurring scheduling semantics and the new runtime-state model.
5. Run focused verification, required review passes, and commit only the task files.

## Verification Target

- Focused tests covering contracts/core/query automation parsing and round-trips
- Focused assistant cron, recurring food, and CLI automation tests
- Relevant package typechecks for touched packages

## Current Status

- Implemented the canonical recurring-timezone refactor across assistant cron, operator contracts, recurring food auto-log, and reverse-dependent CLI expectations.
- Canonical recurring schedules now stay public and timezone-free, while runtime timezone resolution follows the current vault timezone.
- Recurring food auto-log now projects canonical jobs instead of persisting mirrored local cron jobs.
- Assistant cron runtime state now persists the canonical v2 job-keyed runtime store with activation/pending/retry bookkeeping instead of treating `nextRunAt` as canonical stored truth.

## Verification Evidence

- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm --filter @murphai/operator-config typecheck`
- `pnpm --filter @murphai/vault-usecases typecheck`
- `pnpm --filter @murphai/murph typecheck`
- `pnpm --filter @murphai/assistant-engine test`
- `pnpm --filter @murphai/murph exec vitest run --config vitest.config.ts test/assistant-cron.test.ts test/assistant-robustness.test.ts test/cli-expansion-provider-event-samples.test.ts`
- `pnpm --dir packages/assistant-engine test:coverage`
- `pnpm --dir packages/operator-config test:coverage`
- `pnpm --dir packages/vault-usecases test:coverage`
- `pnpm --dir packages/cli verify:coverage`

## Direct Scenario Proof

- Local proof script created a vault in `Australia/Sydney`, added a recurring `14:00` daily job, changed the vault timezone to `Asia/Singapore`, and confirmed the public schedule stayed `{ kind: 'dailyLocal', localTime: '14:00' }` while `nextRunAt` retargeted from `2026-04-15T04:00:00.000Z` to `2026-04-15T06:00:00.000Z`.

## Open Verification Note

- Scoped `bash scripts/workspace-verify.sh test:diff ...` covered the touched owners and reverse dependents but stopped in an out-of-scope reverse-dependent lane when `apps/cloudflare/test/hosted-local-duplicate-commit-e2e.test.ts` timed out in `beforeAll`; owner-level coverage commands above remain green for the touched scheduler packages.
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
