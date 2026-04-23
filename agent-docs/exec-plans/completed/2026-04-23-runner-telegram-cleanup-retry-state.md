Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep the hosted runner's pending cleanup sidecar intact when Telegram cleanup cannot be confirmed, so transient provider or env failures do not erase the only durable retry input for finalize/resume cleanup.

## Success criteria

- `cleanupTransientWakeDataBestEffortForRunDrain` clears `pendingRunCleanup` only after Telegram cleanup succeeds or there is no Telegram cleanup to retry.
- Telegram cleanup env-resolution failures and per-target delete failures leave the sidecar in place.
- Focused Cloudflare regressions cover both failure shapes.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner/{runner-cleanup.ts,runner-run-processor.ts,runner-state-store.ts,types.ts}`
- focused `apps/cloudflare/test/{runner-run-processor,runner-state-store.bundle-slots}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-runner-telegram-cleanup-retry-state.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Broader bundle/browser-vault cleanup recovery changes already tracked in the active hosted snapshot cleanup plan
- Any redesign of hosted delivery-outcome persistence beyond the existing pending cleanup sidecar

## Constraints

- Preserve unrelated dirty-tree edits in the overlapping Cloudflare runner files.
- Keep the fix narrow to retry-state retention and directly coupled tests.
- Treat this as a high-risk `apps/cloudflare` reliability change: truthful verification, required `coverage-write`, and required `task-finish-review`.

## Risks and mitigations

1. Risk: retaining the cleanup sidecar on unrelated non-Telegram failures could leave stale state around indefinitely.
   Mitigation: scope the behavioral change to cleanup paths that actually indicate retryable Telegram cleanup loss.
2. Risk: the current file split between `runner-run-processor.ts` and `runner-cleanup.ts` can make the regression land in the wrong place.
   Mitigation: keep the state-clearing decision inside `RunnerCleanupService`, where the cleanup outcomes are known.

## Tasks

1. Completed: inspect the overlapping runner cleanup files and confirm the current failure mode.
2. Completed: change the cleanup path so the pending cleanup sidecar is retained on Telegram env/delete failures.
3. Completed: add focused regression coverage for per-target delete failures and env-resolution failures, including outcome-derived cleanup retention and later clear-on-retry proof.
4. Completed: run verification plus the required audit passes and assess the exact commit path in the dirty tree.

## Decisions

- Keep the retry-state decision local to `RunnerCleanupService` instead of teaching `RunnerStateStore` or `RunnerRunProcessor` about Telegram-specific cleanup outcomes.
- Do not widen this fix into a new generic cleanup retry queue; retain the existing pending sidecar until the broader cleanup-recovery lane explicitly changes that contract.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-cleanup.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/user-runner/types.ts apps/cloudflare/test/runner-run-processor.test.ts apps/cloudflare/test/runner-state-store.bundle-slots.test.ts`
- `git diff --check`
- Required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- Telegram cleanup failures no longer clear the durable pending cleanup sidecar, and focused Cloudflare tests cover both env-resolution and per-target delete failures.
- Actual results:
- Focused direct proof passed: `pnpm exec vitest run apps/cloudflare/test/runner-run-processor.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage -t 'retains only unresolved Telegram cleanup inputs|retains outcome-derived Telegram cleanup inputs'`
- `git diff --check` passed.
- `pnpm typecheck` is red for unrelated dirty-tree failures in `apps/web/src/lib/hosted-execution/stripe-metering.ts`, `apps/web/src/lib/hosted-onboarding/authentication-service.ts`, `apps/web/test/hosted-execution-stripe-metering.test.ts`, and `apps/web/test/hosted-phone-auth.test.ts`.
- `pnpm --dir apps/cloudflare typecheck` is red for unrelated dirty-tree failures in `packages/core/src/operations/write-batch.ts`.
- `bash scripts/workspace-verify.sh test:diff ...` is red for unrelated dirty-tree/workspace failures in `packages/cli/**`, `packages/assistant-runtime/src/hosted-runtime/{execution,maintenance}.ts`, and `packages/inbox-services/src/inbox-app/bootstrap-doctor.ts`.

## Outcome

- Landed in the shared worktree: Telegram cleanup failures no longer erase the durable pending cleanup sidecar, outcome-derived Telegram cleanup refs are now persisted into that sidecar before finalize cleanup, and focused proof covers both retention-on-failure and clear-on-later-retry behavior.

## Audits

- Required `coverage-write` pass completed with no additional coverage changes required.
- Required `task-finish-review` pass found one real hole: outcome-derived Telegram cleanup refs were not yet durable on failure. That hole was fixed in this task. An optional follow-up rerun of the final-review pass was attempted but the audit agent hit a usage limit; the post-fix diff stayed small and focused, so close-out proceeded after rerunning the affected local checks.

## Commit note

- No scoped commit was created. `apps/cloudflare/test/runner-run-processor.test.ts` and the shared coordination ledger both carry overlapping active dirty-tree hunks from other rows, and `apps/cloudflare/src/user-runner/runner-cleanup.ts` is an untracked adjacent helper in this shared refactor state, so an exact task-only commit would have absorbed unrelated work.
