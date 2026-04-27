# Make scheduled-log the canonical recurring food auto-log mechanism

Status: implemented; awaiting clean-tree completion
Created: 2026-04-27
Updated: 2026-04-27

## Goal

- Make `scheduled-log` the single canonical recurring auto-log mechanism for saved food meals.
- Keep `vault-cli food schedule` / `food unschedule` as command-intent aliases that create, update, or archive `bank/scheduled-logs` records instead of persisting `food.autoLogDaily`.
- Remove or deprecate the assistant food-specific cron source and execution branch after scheduled-log coverage proves equivalent daily meal behavior.

## Success criteria

- `food schedule` writes a recurring `scheduled-log` with `schedule.kind = "dailyLocal"` and `action.kind = "meal.add"` using the resolved saved food id.
- `food unschedule` updates the generated scheduled-log rather than mutating food frontmatter.
- Scheduled-log execution remains idempotent and meal nutrition inheritance continues to work.
- Food frontmatter no longer accepts or emits `autoLogDaily`.
- Assistant cron no longer needs a separate food auto-log job source or execution branch, except for any explicit migration/idempotency bridge needed for existing external refs.
- Focused tests cover CLI alias behavior, usecase/core persistence, scheduled-log execution, and removed food-cron source behavior.

## Scope

- In scope:
  - `packages/contracts`, `packages/core`, `packages/vault-usecases`, `packages/cli`, `packages/assistant-engine`, and direct tests/docs required for this migration.
  - Hard-cut removal of old `autoLogDaily` storage and food-specific cron code.
- Out of scope:
  - Broad health bank schema redesign unrelated to recurring saved food meals.
  - Hosted runtime or app UI changes unless a compile-time consumer requires a minimal adapter.
  - Release/version bump work.

## Constraints

- Technical constraints:
  - Canonical product truth for recurring meals must live under `vault/**` and be written through core-owned mutation paths.
  - Package dependencies must stay acyclic and use package public entrypoints.
  - Preserve unrelated dirty-tree edits.
- Product/process constraints:
  - Use the repo plan/ledger workflow.
  - Run typecheck and coverage-bearing focused verification unless blocked by unrelated active checkout failures.
  - Run required completion audit passes before handoff.

## Risks and mitigations

1. Risk: CLI compatibility alias creates duplicate generated scheduled logs.
   Mitigation: use a stable generated scheduled-log identity or matching selector and cover schedule update/unschedule tests.
2. Risk: Assistant cron removal breaks non-food scheduled-log jobs.
   Mitigation: keep scheduled-log cron path untouched except for narrow source union cleanup and run existing scheduled-log cron tests.

## Tasks

1. Trace current food schedule, scheduled-log mutation, and assistant cron source/execution boundaries.
2. Choose the stable generated scheduled-log identity.
3. Implement `food schedule` / `food unschedule` as scheduled-log aliases.
4. Remove/deprecate food-specific auto-log persistence, hooks, source records, and execution branch where safe.
5. Update contracts/query/docs/tests and regenerate artifacts only when required by changed schemas.
6. Run focused verification, required audits, and close/commit if safe in the shared dirty tree.

## Decisions

- Source of truth: `scheduled-log` canonical records own recurring saved-food meal auto-logging.
- Greenfield hard cut: remove `food.autoLogDaily` rather than migrating legacy records in this change.
- Downstream consumers in scope: CLI compatibility aliases and assistant cron source/execution.
- Edit order: contracts/core/usecases first, then CLI, then assistant-engine cleanup, then docs/tests/generated artifacts.

## Verification

- `pnpm --dir packages/contracts generate` passed.
- `pnpm --dir packages/vault-usecases build` passed.
- `pnpm --dir packages/cli gen:config-schema` passed.
- `pnpm typecheck` passed.
- Focused tests passed:
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-cron.test.ts packages/cli/test/cli-expansion-provider-event-samples.test.ts packages/cli/test/food-save-typed-parity.test.ts --no-coverage`
  - `pnpm exec vitest run --config vitest.config.ts test/assistant-cron-runtime.test.ts test/assistant-cron-mutations.test.ts test/assistant-cron-thresholds.test.ts --no-coverage` from `packages/assistant-engine`
- `pnpm test` is blocked by unrelated active-checkout failures:
  - `assistant-runtime/test/hosted-runtime-events-coverage.test.ts`
  - `device-syncd/test/service.test.ts`
  - `packages/cli/test/health-tail.test.ts`
  - `packages/cli/test/document-meal-intervention-coverage.test.ts`
  - `packages/cli/test/workout-command-coverage.test.ts`
  - `packages/cli/test/device-daemon.test.ts`
