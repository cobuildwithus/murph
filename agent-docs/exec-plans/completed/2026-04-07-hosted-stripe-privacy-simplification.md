## Goal (incl. success criteria):
- Simplify hosted Stripe billing persistence to the smallest durable shape that still supports entitlement, retry/idempotency, and hosted AI Stripe metering.
- Make Stripe the source of detailed billing truth: no durable checkout history, no durable Stripe event payload/archive rows, and no durable latest-event/latest-checkout convenience fields.
- Success means the hosted-web schema and runtime keep only stable `stripeCustomerId` / `stripeSubscriptionId` linkage plus minimal Stripe receipt state, billing activation still behaves correctly, AI metering still works, and tests/docs reflect the new architecture.

## Constraints/Assumptions:
- Preserve unrelated dirty-tree edits, especially active hosted webhook, device-sync, share, and assistant/Codex lanes.
- The user confirmed this is greenfield, does not need durable checkout receipts, accepts Stripe availability dependence to keep the system simple, and considers RevNet out of scope for the architecture.
- Keep Stripe AI metering working; durable Stripe customer linkage remains justified by that requirement.
- Update durable docs when the hosted billing persistence contract changes.

## Key decisions:
- Treat Stripe as the source of detailed billing truth and Postgres as the owner of entitlement, stable member-to-Stripe linkage, and retry/idempotency state only.
- Formalize `memberId` as the canonical Stripe-side join hint via customer/subscription metadata and Checkout `client_reference_id`.
- Remove durable `HostedBillingCheckout` history rather than shrinking it to a local receipt/archive surface.
- Replace `HostedStripeEvent` archival fields with minimal receipt/retry state and re-fetch Stripe objects during reconciliation.
- Keep only durable `stripeCustomerId` and `stripeSubscriptionId` on `HostedMemberBillingRef`; remove latest billing-event / latest checkout-session retention.
- Keep `invoice.paid` as the only positive billing activation source, with `customer.subscription.*` remaining status/negative handling only.

## State:
- completed

## Done:
- Read the required routing, architecture, security, verification, completion-workflow, and Stripe guidance docs.
- Re-read the current hosted billing, Stripe webhook, billing-ref privacy, checkout, and AI metering code paths.
- Confirmed the current durable sinks: `HostedBillingCheckout`, `HostedStripeEvent`, and convenience latest-event/latest-checkout fields on `HostedMemberBillingRef`.
- Confirmed the long-term simplifying assumptions directly with the user.
- Registered the task in the coordination ledger.
- Removed durable hosted checkout history and the obsolete checkout-attempt helper/test.
- Collapsed hosted member Stripe refs to durable customer/subscription linkage only.
- Shrunk hosted Stripe event persistence to receipt/retry state and re-fetch live Stripe events during reconciliation.
- Made checkout completion bind Stripe refs without granting access, and made invoice/subscription writes fail closed on missing canonical Stripe subscription state.
- Updated targeted tests, migration/docs, and fixed the reset script lookup to use `privyUserLookupKey`.
- Completed required simplify and final review passes, then applied the resulting fixes.

## Now:
- Close the plan and commit the scoped hosted Stripe simplification paths.

## Next:
- None.

## Open questions (UNCONFIRMED if needed):
- None.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-07-hosted-stripe-privacy-simplification.md`
- `apps/web/prisma/schema.prisma`
- `apps/web/src/lib/hosted-onboarding/**`
- `apps/web/src/lib/hosted-execution/{usage,stripe-metering}.ts`
- `apps/web/test/**`
- `apps/web/README.md`
- `ARCHITECTURE.md`
- `docs/hosted-contact-privacy-rotation.md`
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
