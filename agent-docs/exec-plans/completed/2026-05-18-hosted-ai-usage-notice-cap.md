# Hosted AI usage notice cap

Status: completed
Created: 2026-05-18
Updated: 2026-05-18

## Goal

- Stop repeated hosted AI usage-limit Linq replies for the same exhausted
  allowance period by honoring the existing per-period notice claim.

## Success criteria

- A user receives at most one Linq usage-limit message for a given hosted AI
  allowance period.
- Later messages blocked by the same exhausted period are ignored instead of
  sending another quota reply or nudging the runner.
- A fresh allowance period can still resume normal runner wakes.
- Focused hosted-web tests cover the first notice, repeat suppression, and reset
  behavior.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts`
- Out of scope:
- Usage pricing, allowance accounting, Stripe billing, schema changes,
  Cloudflare runner behavior, and daily Linq quota notices.

## Constraints

- Technical constraints:
- Reuse `HostedAiUsagePeriod.limitNoticeSentAt`; do not add new persisted state.
- Keep web as the usage-gate owner and keep Cloudflare out of this decision.
- Preserve the existing generic ignored reason for suppressed repeats.
- Product/process constraints:
- Avoid exposing identifiers, message bodies, or route details in docs/logs.
- Preserve unrelated dirty worktree edits.

## Risks and mitigations

1. Risk: Claiming before send can suppress a retry if provider delivery fails.
   Mitigation: This matches the existing one-shot notice design and favors
   duplicate prevention.
2. Risk: Confusing daily Linq quota and AI usage quota behavior.
   Mitigation: Only gate the AI usage-limit path on the usage-period claim; keep
   daily quota notice logic unchanged.

## Tasks

1. Done: Confirm existing notice state and the repeat-send bug in the Linq
   planner.
2. Done: Honor the claim result in the inline Linq usage-denied branch.
3. Done: Update focused hosted-web tests.
4. Done: Run targeted verification, typecheck, and completion reviews.
5. Now: Close the plan and commit the scoped change
   if safe.

## Decisions

- Use the existing one-notice-per-allowance-period state instead of introducing
  a configurable counter. One notice is simpler and matches the prior completed
  design.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-linq-usage-reset-e2e.test.ts test/hosted-execution-usage-allowance.test.ts test/hosted-execution-usage-gate-notice.test.ts`
- `pnpm --filter @murphai/hosted-web typecheck:prepared`
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts`
- `git diff --check -- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts agent-docs/exec-plans/active/2026-05-18-hosted-ai-usage-notice-cap.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Expected outcomes:
- Focused tests and typecheck pass, or any unrelated blocker is recorded with
  exact scope.
- Results:
  - `pnpm --dir apps/web test -- test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-linq-usage-reset-e2e.test.ts test/hosted-execution-usage-allowance.test.ts test/hosted-execution-usage-gate-notice.test.ts` passed.
  - `pnpm --filter @murphai/hosted-web typecheck:prepared` passed.
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts` passed.
  - `pnpm typecheck` passed.
  - `git diff --check -- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts agent-docs/exec-plans/active/2026-05-18-hosted-ai-usage-notice-cap.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - `security-privacy-review` found no findings; residual tradeoff is the existing claim-before-send behavior.
  - `coverage-write` made no changes and found no meaningful missing proof.
  - `task-finish-review` found no findings.
Completed: 2026-05-18
