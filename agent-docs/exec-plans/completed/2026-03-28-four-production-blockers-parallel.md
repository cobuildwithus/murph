# 2026-03-28 Four Production Blockers Parallel

## Goal

Land the four remaining production blockers called out by the user:

1. Close the duplicate-broadcast window in hosted RevNet invoice issuance.
2. Make hosted webhook side effects fail closed when an external send succeeds before receipt persistence.
3. Eliminate the zero-artifact duplicate-send window in assistant auto-reply automation.
4. Resync Ink chat model/reasoning state after provider/session mutations such as failover.

## Constraints

- Use parallel Codex-4 workers as requested.
- Do not widen scope beyond the four named issues and the minimum truthful supporting tests/docs.
- Preserve current duplicate/backfill/fail-closed behavior anchors called out in the user prompts.
- Respect the active coordination ledger, including the explicit exclusive lane already covering `packages/cli/src/assistant/ui/ink.ts`.
- Do not overwrite unrelated dirty worktree edits.

## Worker Split

The requested prompts are not safe in one shared worktree:

- prompts 1 and 2 both plausibly need `apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- prompts 3 and 4 both plausibly need `packages/cli/test/assistant-runtime.test.ts`
- prompt 4 overlaps the active exclusive `packages/cli/src/assistant/ui/ink.ts` lane

So each prompt will run in its own isolated git worktree, with the main tree used only for orchestration and later integration.

## Planned Shape

1. Register the orchestration lane in `COORDINATION_LEDGER.md`.
2. Create four isolated worktrees rooted at the current `HEAD`, with shared dependency access via symlinked `node_modules`.
3. Launch one Codex-4 worker per prompt using the `codex-workers` skill helper against each isolated worktree.
4. Review each worker diff and integrate the landed changes back into the main worktree without disturbing unrelated dirty files.
5. Run targeted verification for each changed area, then repo-required checks.
6. Run the mandatory `simplify`, `test-coverage-audit`, and `task-finish-review` spawned audit passes.
7. Address findings, close the plan, and commit only the touched files for this task.

## Verification Target

- Focused hosted onboarding tests for prompts 1 and 2.
- Focused CLI assistant automation/chat tests for prompts 3 and 4.
- Repo-required commands after integration:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Status

- Parallel worker integration completed.
- Focused hosted onboarding regressions passing:
  - RevNet tx-hash persistence failure
  - stale generic submitting repair gating
  - Linq post-send persistence failure
  - Linq double receipt-write failure fallback
- Focused CLI regressions passing:
  - auto-reply successful delivery plus first-artifact-write failure
  - Ink failover/session mutation selection resync
- Repo-wide checks rerun:
  - `pnpm typecheck` fails in pre-existing `packages/contracts` build/export errors
  - `pnpm test` fails in pre-existing workspace build errors and a retry-time `packages/core/dist` cleanup collision
  - `pnpm test:coverage` fails in pre-existing Next/workspace package export resolution errors
- Mandatory audit passes launched after the final implementation pass.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
