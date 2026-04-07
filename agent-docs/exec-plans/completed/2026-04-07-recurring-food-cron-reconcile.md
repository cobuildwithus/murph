# Reconcile recurring food cron state from canonical food writes

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make recurring food scheduling derive consistently from the canonical food record so `autoLogDaily` edits cannot leave the vault in a half-configured state with no runnable cron job.

## Success criteria

- Editing or upserting a food with `autoLogDaily` present ensures exactly one matching recurring food cron job exists.
- Clearing `autoLogDaily` removes any recurring food cron jobs for that food.
- Existing mismatch cases where the food says it auto-logs but the cron job is missing are repaired by the write path.
- Targeted recurring food tests pass, and verification captures the repaired mismatch path.

## Scope

- In scope:
- `packages/assistant-engine/src/usecases/food.ts`
- Focused CLI/runtime tests covering recurring food edit and schedule reconciliation
- Out of scope:
- Broad scheduler redesigns
- Non-food cron job behavior
- Unrelated build/runtime failures already present in the worktree

## Constraints

- Keep the change composable and simple: reconcile in one write seam rather than spreading logic across many commands.
- Preserve unrelated dirty worktree edits.
- Do not invent a second source of truth for recurring food schedules.

## Risks and mitigations

1. Risk: Reconciliation removes a valid job and fails to recreate it.
   Mitigation: Prefer no-op when the existing job already matches; otherwise replace only within the focused food write flow and cover the missing-job repair case with tests.
2. Risk: The fix sprawls across command surfaces.
   Mitigation: Centralize reconciliation under the existing food upsert path used by edit/upsert/rename flows.

## Tasks

1. Inspect food write paths and select a single reconciliation seam.
2. Implement recurring food cron reconciliation in that seam.
3. Add focused tests for mismatch repair and schedule mutation behavior.
4. Run targeted tests and required verification.
5. Complete audit review, close the plan, and commit touched paths.

## Decisions

- Treat the food record as the canonical declarative source for recurring food scheduling; cron state is derived operational state that must be reconciled after writes.

## Verification

- Commands to run:
- `pnpm exec vitest run --config vitest.config.ts`
- `pnpm typecheck`
- `pnpm exec tsx <<'EOF' ... EOF`
- Expected outcomes:
- Focused recurring food scheduler tests pass; typecheck is green or any failure is clearly unrelated and documented.
- Results:
- `pnpm exec vitest run --config vitest.config.ts` from `packages/assistant-engine` passed with 5 tests covering missing-job repair, retiming, clear/remove, duplicate collapse, and rename refresh.
- `pnpm typecheck` still fails for the pre-existing unrelated CLI test error in `packages/cli/test/cli-expansion-workout.test.ts:1588` (`TS7053` on indexing `{}` with `0`).
- Direct scenario proof passed via a temporary vault script: schedule recurring food at `08:00`, remove the cron job, run `food edit`, then confirm exactly one repaired `food-daily:morning-protein-drink` job exists again at `08:00`.
Completed: 2026-04-07
