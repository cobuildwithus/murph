# Hosted Onboarding Greenfield Cutover Cleanup

Status: completed
Created: 2026-04-04
Updated: 2026-04-04

## Goal

- Remove the remaining hosted onboarding/runtime compatibility branches that are no longer needed because the hosted cutover is greenfield and there are no existing deployments to preserve.

## Success criteria

- Hosted scheduler auth in `apps/web` requires `HOSTED_EXECUTION_SCHEDULER_TOKENS` only.
- Checked-in native Vercel cron config and any docs/tests that still imply `CRON_SECRET` or `apps/web/vercel.json` support are removed or updated.
- Hosted webhook receipts no longer store or rebuild inline `member.activated.firstContact`; the durable hosted-member hydration path is the only remaining activation-targeting path.
- Focused hosted verification covers the cutover behavior directly.

## Scope

- In scope:
- `apps/web` hosted scheduler auth, hosted webhook-receipt payload shaping, focused docs, and focused tests
- Out of scope:
- unrelated assistant-core hosted-config legacy parsing under the active assistant refactor lane
- broader Vercel/public-origin behavior unrelated to the removed native cron fallback

## Constraints

- Keep the cleanup narrowly scoped to greenfield-only compatibility behavior in hosted onboarding/runtime.
- Preserve unrelated dirty-tree edits and port onto current files instead of assuming prior completed plans still match the live tree.
- Treat removed compatibility paths as fail-closed, not silently reinterpreted through new shapes.

## Risks and mitigations

1. Risk: Removing receipt payload compatibility could break a still-live path.
   Mitigation: Limit the cut to `member.activated` receipt fields/branches that are no longer produced anywhere in the current hosted flow, and keep focused tests around the remaining Linq/Telegram receipt payload shapes.
2. Risk: Scheduler cleanup could leave docs/tests/config out of sync.
   Mitigation: Remove the checked-in Vercel cron file in the same change as the auth/message updates and rerun the focused scheduler route tests.

## Tasks

1. Remove `CRON_SECRET` scheduler fallback behavior and stale native Vercel cron config/docs/tests.
2. Remove webhook-receipt `member.activated.firstContact` compatibility support so receipt payloads stay sparse.
3. Run focused hosted verification, then complete the required review and scoped commit flow.

## Decisions

- Treat this as a greenfield hard cut: no compatibility path is required for previously deployed hosted onboarding data or scheduler wiring.

## Verification

- Commands to run:
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-internal.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-onboarding-webhook-receipt-transitions.test.ts`
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
- `pnpm --dir apps/web lint`
- Expected outcomes:
- Focused hosted scheduler, receipt, and onboarding tests pass and the repo no longer advertises the removed cron fallback.

## Outcome

- Removed the last live `CRON_SECRET` scheduler fallback and deleted the checked-in `apps/web/vercel.json` cron config.
- Removed webhook-receipt `member.activated.firstContact` storage and rebuild compatibility so the durable hosted-member hydration path is the only remaining activation-targeting path.
- Verification passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-execution-internal.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-onboarding-webhook-receipt-transitions.test.ts`
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-stripe-event-reconciliation.test.ts apps/web/test/hosted-onboarding-webhook-idempotency.test.ts`
  - `pnpm --dir apps/web lint`
- Final audit result: required review-only audit pass returned no findings.
Completed: 2026-04-04
