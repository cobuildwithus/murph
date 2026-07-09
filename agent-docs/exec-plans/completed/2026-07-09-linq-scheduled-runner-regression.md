# Linq Scheduled Runner Regression E2E

## Goal

Add full hosted-local E2E proof that a saved Linq `at` automation is materialized into the hosted scheduled runner and fires later without requiring another inbound message.

## Constraints

- Test-only change unless a real harness gap is found.
- Prefer extending the existing `linq-scheduled-reminder` scenario over adding another slow full-stack scenario.
- Preserve messaging deliverability invariants: no new broad outbound volume, no live Linq calls, no production secrets.
- Keep the regression focused on scheduled-runner materialization and no-manual-nudge delivery.

## Plan

1. Inspect existing Linq/Telegram scheduled-reminder hosted-local E2E patterns.
2. Add Linq scheduled wake materialization assertions after automation save.
3. Ensure the reminder wait remains a no-nudge/no-inbound wait.
4. Run focused hosted-local registry/helper tests and the targeted hosted-local E2E if feasible.
5. Run required typecheck/test lane, final review, and close this plan with a scoped commit.

## Verification

- Focused hosted-local Linq scheduled-reminder E2E.
- Focused scenario registry/helper tests if touched.
- `pnpm typecheck` or the truthful scoped fallback required by verification docs.

## State

Implemented 2026-07-09.

- Extended the existing full-stack `linq-scheduled-reminder` hosted-local E2E.
- Added a status assertion that the hosted workspace materializes a future wake not later than the saved Linq automation due time.
- Tightened the scheduled reminder wait so it passively observes the expected Linq reminder text after the due time without another inbound webhook or runner nudge.
- Verification passed:
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm hosted-local e2e linq-scheduled-reminder`
  - `bash scripts/workspace-verify.sh test:diff apps/cloudflare/test/hosted-local-linq-scheduled-reminder-e2e.test.ts agent-docs/exec-plans/active/2026-07-09-linq-scheduled-runner-regression.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
Status: completed
Updated: 2026-07-09
Completed: 2026-07-09
