Repository bootstrap:

- Before editing, read `AGENTS.md` and follow it.
- Treat that file as required worker bootstrap, not optional background context.
- If it points to additional repo docs, follow the stated read order before making code changes.
- If it requires coordination or audit workflow steps, do those explicitly rather than assuming the parent wrapper handled them.

This prompt is for Batch 3 and should run only after Batch 2 auth and messaging cutovers are reviewed and integrated.

You own the Stripe and billing-reference cutover off the wide `HostedMember` row.

Constraints:

- Preserve unrelated dirty-tree edits.
- Assume the additive billing-ref table/helper surface already exists from Batch 1.
- Keep `HostedMember.billingStatus` and `HostedMember.billingMode` as the entitlement surface.
- Preserve Stripe freshness monotonicity, same-second collision handling, checkout reuse, and suspension semantics.
- Do not remove legacy `HostedMember` columns in this lane unless required for a tiny compile fix.

Goals:

- Move Stripe customer id, subscription id, latest checkout session id, and latest billing-event freshness fields to `HostedMemberBillingRef`.
- Refactor the billing and reconciliation layers to read/write Stripe refs through that table/helper surface.
- Update any metering or usage helpers that still read Stripe customer id directly off `HostedMember`.

Primary files:

- `apps/web/src/lib/hosted-onboarding/billing-service.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-policy.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-billing-events.ts`
- `apps/web/src/lib/hosted-onboarding/stripe-event-reconciliation.ts`
- `apps/web/src/lib/hosted-execution/stripe-metering.ts`
- `apps/web/src/lib/hosted-execution/usage.ts`
- focused tests under `apps/web/test/**`

Acceptance:

- Stripe refs and freshness cursors no longer live on the core `HostedMember` row.
- Entitlement still reads from `billingStatus` and `billingMode` on `HostedMember`.
- Stripe ordering and idempotency semantics stay intact.
