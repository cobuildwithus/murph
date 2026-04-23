Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Keep the hosted runner's pending cleanup sidecar intact when Linq cleanup cannot be confirmed, so transient provider or env failures do not erase the only durable retry input for finalize/resume cleanup.

## Success criteria

- `cleanupTransientWakeDataBestEffortForRunDrain` clears `pendingRunCleanup` only after Linq cleanup succeeds or there is no Linq cleanup to retry.
- Linq cleanup env-resolution failures and delete failures leave the sidecar in place.
- Focused Cloudflare regressions cover both failure shapes.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner/{runner-cleanup.ts,runner-run-processor.ts}`
- focused `apps/cloudflare/test/runner-run-processor.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-runner-linq-cleanup-retry-state.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Broader bundle/browser-vault cleanup recovery changes already tracked in the active hosted snapshot cleanup plan
- Any redesign of hosted delivery-outcome persistence beyond the existing pending cleanup sidecar

## Constraints

- Preserve unrelated dirty-tree edits in the overlapping Cloudflare runner files.
- Keep the fix narrow to retry-state retention and directly coupled tests.
- Treat this as a high-risk `apps/cloudflare` reliability change: truthful verification, required `coverage-write`, and required `task-finish-review`.

## Risks and mitigations

1. Risk: retaining the cleanup sidecar on unrelated non-Linq failures could leave stale state around indefinitely.
   Mitigation: scope the behavioral change to cleanup paths that actually indicate retryable Linq cleanup loss.
2. Risk: the current file split between `runner-run-processor.ts` and `runner-cleanup.ts` can make the regression land in the wrong place.
   Mitigation: keep the state-clearing decision inside `RunnerCleanupService`, where the cleanup outcomes are known.

## Tasks

1. Completed: inspect the overlapping runner cleanup files and confirm the current Linq cleanup failure mode.
2. Completed: confirmed the current dirty-tree `RunnerCleanupService` already retains the pending cleanup sidecar on Linq env/delete failures instead of clearing it.
3. Completed: added focused regression coverage for Linq delete failures, Linq env-resolution failures, and the later successful retry path that clears the sidecar.
4. Completed: ran focused proof, the required audit passes, and assessed the commit path in the dirty tree.

## Decisions

- Keep the retry-state decision local to `RunnerCleanupService` instead of teaching `RunnerStateStore` or `RunnerRunProcessor` about Linq-specific cleanup outcomes.
- Do not widen this fix into a new generic cleanup retry queue; retain the existing pending sidecar until the broader cleanup-recovery lane explicitly changes that contract.

## Verification

- Commands to run:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-cleanup.ts apps/cloudflare/src/user-runner/runner-run-processor.ts apps/cloudflare/test/runner-run-processor.test.ts`
- `git diff --check`
- Required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- Linq cleanup failures no longer clear the durable pending cleanup sidecar, and focused Cloudflare tests cover both env-resolution and delete-failure behavior.
- Actual results:
- `pnpm exec vitest run apps/cloudflare/test/runner-run-processor.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage -t "retains only unresolved Linq cleanup inputs when Linq delete fails|retains the pending cleanup sidecar when Linq cleanup env resolution fails|reuses persisted wake cleanup data when finalize resumes later"` passed (`3 passed`, `26 skipped`).
- `pnpm exec vitest run apps/cloudflare/test/runner-run-processor.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage -t "retains only unresolved Linq cleanup inputs when Linq delete fails|retains the pending cleanup sidecar when Linq cleanup env resolution fails"` passed during the required `coverage-write` pass (`2 passed`, `27 skipped`).
- `git diff --check -- apps/cloudflare/test/runner-run-processor.test.ts agent-docs/exec-plans/active/2026-04-23-runner-linq-cleanup-retry-state.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- Full-file `apps/cloudflare/test/runner-run-processor.test.ts` remains red on pre-existing forwarded-env expectation failures outside this Linq cleanup slice.
- `bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner/runner-cleanup.ts apps/cloudflare/test/runner-run-processor.test.ts agent-docs/exec-plans/active/2026-04-23-runner-linq-cleanup-retry-state.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` remains red on unrelated workspace-boundary failures plus unrelated `apps/cloudflare` typecheck failures already present elsewhere in the dirty tree.
- `pnpm typecheck` remains red on unrelated pre-existing `packages/inboxd` typecheck failures while another active app verify held the workspace lock.

## Outcome

- Focused Linq cleanup-retention proof is green, and the current dirty-tree cleanup implementation matches the intended retain-on-failure behavior.

## Audits

- `coverage-write` completed with no extra edits required; it confirmed the Linq regression coverage is sufficient for this slice.
- `task-finish-review` found one proof gap in the successful retry path; that was fixed by asserting the sidecar clears after the later successful retry, and the focused Vitest proof was rerun green.

## Commit note

- No scoped commit was created. The touched ledger file and `apps/cloudflare/test/runner-run-processor.test.ts` both already contain overlapping unrelated dirty-tree edits, so a path-level commit would absorb work outside this narrow Linq cleanup lane.
Completed: 2026-04-24
