# Homepage usage reset countdown

Status: completed
Created: 2026-05-13
Updated: 2026-05-13

## Goal

- Show a clear reset countdown on the homepage usage-limit banner when included monthly assistant usage is exhausted.
- Verify the hosted AI usage gate automatically opens a fresh allowance period after the current period ends.

## Success criteria

- Homepage monthly usage-limit banners can show copy such as `Usage resets in 6d`.
- The countdown is derived from the existing hosted AI usage gate decision, not a duplicate billing read.
- Focused tests prove the UI copy and fresh-period allowance behavior.
- Required hosted-web checks and completion audits pass, or any unrelated blocker is clearly documented.

## Scope

- In scope:
  - `apps/web` homepage usage-limit banner props/rendering.
  - Hosted AI usage allowance tests for period rollover.
  - Focused homepage render tests.
- Out of scope:
  - Changing allowance pricing, plan limits, billing reconciliation, Stripe state, or Cloudflare enforcement.
  - Adding a cron/reset job.
  - Reworking billing settings UI.

## Constraints

- Web remains the canonical owner of hosted AI usage policy/accounting.
- Preserve unrelated dirty worktree edits.
- Do not expose local identifiers, secrets, or user data in code, docs, tests, logs, or handoff.

## Risks and mitigations

1. Risk: Countdown could drift from the actual gate reset.
   Mitigation: Use the gate decision's `retryAfter`/period end from the same server render.
2. Risk: UI suggests a reset that the backend does not perform.
   Mitigation: Add a focused rollover test showing the next period is created/read as a clean allowance window on gate resolution.
3. Risk: Billing-period and calendar fallback behavior could be confused.
   Mitigation: Keep backend logic unchanged and test the existing calendar fallback rollover path explicitly.

## Tasks

1. Pass a stable server timestamp and reset date from the homepage gate decision into the usage banner.
2. Render concise monthly reset countdown copy for monthly usage-limit notices.
3. Add focused homepage and allowance rollover tests.
4. Run focused verification and required audit passes.

## Verification

- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/dashboard-home-page.test.tsx test/hosted-execution-usage-allowance.test.ts` passed.
- `pnpm --dir apps/web typecheck` passed.
- `git diff --check -- apps/web/app/(dashboard)/home/page.tsx apps/web/src/components/home/usage-limit-banner.tsx apps/web/test/dashboard-home-page.test.tsx apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/README.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md agent-docs/exec-plans/active/2026-05-13-homepage-usage-reset-countdown.md` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/app/(dashboard)/home/page.tsx apps/web/src/components/home/usage-limit-banner.tsx apps/web/test/dashboard-home-page.test.tsx apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/README.md agent-docs/exec-plans/active/2026-05-13-homepage-usage-reset-countdown.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed. It reported existing lint warnings in `apps/web/src/lib/device-sync/agent-session-service.ts` and an existing Turbopack NFT warning in `apps/web/next.config.ts`.
- Security/privacy, frontend, coverage, and final finish-review audits found no functional blockers. The final finish review only flagged commit hygiene because unrelated worktree edits exist outside this task.

## Handoff

- Ready for scoped finish/commit. Preserve unrelated active worktree edits.
Completed: 2026-05-13
