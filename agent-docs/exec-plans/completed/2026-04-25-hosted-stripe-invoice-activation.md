# Fix hosted Stripe invoice activation freshness

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Make hosted onboarding activation resilient when Stripe delivers `invoice.paid` with an older Stripe-created timestamp than nearby passive checkout or subscription events.

## Success criteria

- `invoice.paid` remains the only positive Stripe entitlement source for new hosted access.
- Passive checkout/subscription events can bind refs and mirror state, but cannot block a valid paid invoice for the same member/customer/subscription.
- A paid invoice that follows a newer passive event still marks the hosted member active and appends the activation ingress exactly through the existing activation path.
- Hosted Stripe ref freshness remains monotonic; allowing a positive invoice must not move `lastStripeEventCreatedAt` backwards.
- Focused regression coverage proves the observed out-of-order timestamp case.

## Scope

- In scope:
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts` only if needed for a clear call-site contract
- directly coupled hosted Stripe billing tests under `apps/web/test/**`
- `agent-docs/exec-plans/active/{2026-04-25-hosted-stripe-invoice-activation.md,COORDINATION_LEDGER.md}`
- Out of scope:
- production repair/replay for already-stuck members
- Stripe schema changes or new persisted columns
- hosted onboarding UI copy changes
- Cloudflare hosted runner changes

## Constraints

- Keep the patch simple and domain-local.
- Do not activate from `checkout.session.completed` or `customer.subscription.*`.
- Preserve blocked/suspended-member protections in the existing activation helper.
- Preserve unrelated dirty-tree edits and active hosted onboarding/auth rows.
- Treat payment state as high-sensitivity; do not log or fixture real customer, subscription, or member identifiers.

## Tasks

1. Completed: register this plan and ledger row.
2. Completed: inspect current Stripe billing policy/event tests and helper contracts.
3. Completed: implement source-aware positive-invoice freshness handling with monotonic ref timestamp preservation.
4. Completed: add focused regression tests for newer passive ref state followed by older `invoice.paid`, mismatched refs, newer negative billing state, and missing optional refs.
5. Completed: run focused verification, security/privacy review, coverage-write, task-finish-review, and rerun affected checks after findings.
6. Pending: close the plan and create a scoped commit if exact staging is safe in the dirty tree.

## Decisions

- Keep `invoice.paid` as the single new-access grant source.
- Do not solve already-stuck production repair in this patch; repair will be handled separately after the code path is safe.

## Verification

- Commands to run:
- focused hosted Stripe billing Vitest files
- `pnpm --dir apps/web lint`
- `pnpm --dir apps/web typecheck` or record unrelated blockers
- `bash scripts/workspace-verify.sh test:diff <task paths>` where truthful for this slice
- `git diff --check`
- required completion audit passes: `security-privacy-review`, `coverage-write`, `task-finish-review`
- Current outcomes:
- `pnpm exec vitest run apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts --config apps/web/vitest.config.ts --no-coverage` passed with 2 files and 15 tests.
- `pnpm --dir apps/web typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts apps/web/test/hosted-onboarding-stripe-billing-policy.test.ts apps/web/test/hosted-onboarding-stripe-billing-events.test.ts` passed, including `apps/web verify`.
- `git diff --check -- <task paths>` passed.
- `security-privacy-review` completed with no findings.
- `coverage-write` completed without changes and confirmed the focused tests are the right tradeoff.
- `task-finish-review` found a missing-ref preservation edge; the implementation now preserves current Stripe refs on stale positive invoice writes when incoming values are missing, with a focused regression.

## Outcome

- Implementation complete. Remaining work is commit/plan closure if the shared dirty ledger can be handled safely.
Completed: 2026-04-25
