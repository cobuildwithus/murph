# Land bounded hosted runner alarm wait and longer nudge workflow retry

Status: verification-complete
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Land the supplied greenfield hosted-runner reliability patch without widening the current hosted wake architecture.
- Hosted runner alarm drains should not wait indefinitely behind an active Durable Object invocation.
- Hosted webhook nudge workflows should retry long enough to cover brief deploys or transient runner/web outages after direct handoff already failed.

## Success criteria

- `apps/cloudflare/src/user-runner.ts` bounds the active-invocation wait before rescheduling a near-term alarm retry.
- `apps/cloudflare/test/user-runner-alarm.test.ts` covers the bounded alarm wait behavior.
- `apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts` extends the durable nudge workflow retry budget.
- `apps/web/test/hosted-onboarding-webhook-workflows.test.ts` directly asserts the workflow step retry budget.
- Required focused verification, security/privacy review, coverage review, and final completion review are completed or any unrelated blockers are documented.
- The plan is closed and the scoped changed files are committed if verification and overlap checks allow it.

## Scope

- In scope:
  - Apply and review the supplied patch for the hosted Cloudflare runner and hosted web webhook workflow retry constants.
  - Add only directly coupled tests needed for the bounded active-invocation alarm behavior.
  - Add a directly coupled hosted-web workflow assertion for the changed retry budget.
  - Preserve existing direct nudge, mailbox-item workflow fallback, and no-queue wake architecture.
- Out of scope:
  - Reintroducing Cloudflare Queues or alternate wake executors.
  - Changing deployment config, runtime provider behavior, or hosted mailbox semantics.
  - Touching unrelated dirty files in this checkout.

## Constraints

- Technical constraints:
  - Durable Object alarms are a backstop and must not be coupled to unbounded runner/container/provider wall time.
  - Retry behavior must remain pointer-only and mailbox-item based for hosted web workflows.
  - No new persisted product truth is introduced.
- Product/process constraints:
  - Follow high-risk repo runtime workflow, including coordination ledger, required audit passes, tests, typecheck, and a scoped commit unless blocked by unrelated overlap.
  - Do not expose local personal identifiers, secrets, raw message content, or environment values.

## Risks and mitigations

1. Risk: A short wait could schedule redundant alarms while an invocation finishes moments later.
   Mitigation: Keep the retry near-term and rely on existing nudge/alarm coalescing and idle skip behavior.
2. Risk: Workflow retry expansion could extend unnecessary retries.
   Mitigation: Only the existing pointer-only nudge workflow retry count changes; no message content or raw provider data enters workflow inputs.
3. Risk: Overlap with other active hosted runner/wake work.
   Mitigation: Limit edits to the three supplied files and inspect the touched-file diff before commit.

## Tasks

1. Register the lane in the coordination ledger and inspect the supplied patch.
2. Apply the patch and review the resulting diff against current main.
3. Run focused hosted-runner/webhook tests plus required typecheck.
4. Run required completion audit passes and address any high-signal findings.
5. Close the plan through the repo finish path and create a scoped commit if safe.

## Decisions

- Treat this as a narrow supplied-patch landing but use the high-risk runtime verification/audit path because it changes hosted retry and Durable Object alarm behavior.

## Verification

- Commands to run:
  - `pnpm --dir apps/cloudflare test:workers -- --runInBand test/user-runner-alarm.test.ts`
  - `pnpm --dir apps/cloudflare verify`
  - `pnpm --dir apps/web typecheck`
  - `pnpm typecheck`
  - `git diff --check`
- Expected outcomes:
  - Focused Cloudflare alarm coverage passes.
  - App-local and root typecheck pass unless unrelated active dirty work blocks them, in which case capture exact blockers.
- Results:
  - `patch -p1 --dry-run < "$HOME/Downloads/murph-final-greenfield-fixes.patch"` failed because the supplied patch file was malformed at the first `user-runner.ts` hunk; the same behavior was ported manually.
  - `pnpm --dir apps/cloudflare test:workers -- --runInBand test/user-runner-alarm.test.ts` exited 0 but did not run the file because the Workers config only includes `apps/cloudflare/test/workers/**/*.test.ts`.
  - `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/user-runner-alarm.test.ts` passed: 28 tests.
  - `pnpm --dir apps/cloudflare verify` passed: app typecheck, 61 Node test files / 621 tests, Workers lane had no files by config.
  - `pnpm --dir apps/web typecheck` passed.
  - `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/hosted-onboarding-webhook-workflows.test.ts` passed: 7 tests.
  - `git diff --check -- apps/cloudflare/src/user-runner.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/web/src/lib/hosted-onboarding/webhook-workflow-types.ts agent-docs/exec-plans/active/2026-05-01-hosted-runner-bounded-nudge-retry.md` passed.
  - `pnpm typecheck` failed for unrelated active work in `packages/assistant-engine/test/assistant-automation-support.test.ts`: missing exported member `loadTelegramAutoReplyMetadata`, matching the active `2026-05-01-telegram-inbox-envelope-fallback-removal` ledger row.
