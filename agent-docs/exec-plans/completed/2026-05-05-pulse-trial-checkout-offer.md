# Pulse Trial checkout offer implementation

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Implement the Pulse Trial checkout-offer architecture in `agent-docs/product-specs/pulse-trial-checkout-offer.md`.
- Pulse Trial is a checkout offer on Pulse, not a third plan, separate Stripe product, or separate usage-budget table.

## Success criteria

- Hosted plan codes remain limited to Pulse and Edge.
- Checkout accepts only missing public offer or `pulse_trial_7d`, builds Stripe trial Checkout Sessions for Pulse, and keeps standard Pulse/Edge unchanged.
- Hosted billing refs persist phase, offer, trial boundaries, and immutable trial-redemption policy state.
- Metadata-gated trial activation works from `checkout.session.completed` and the success reconciliation path without weakening paid `invoice.paid` behavior.
- Subscription and invoice reconciliation cannot promote trial to paid until a real paid invoice is accepted.
- The existing hosted AI allowance resolver is phase-aware, applies the persisted trial policy, fails closed for stale/malformed trial state, and never grants calendar Pulse allowance to expired trials.
- Join onboarding presents Pulse Trial instead of hosted Free, with GitHub as a secondary self-hosting link.
- Focused tests and required repo verification/audits cover the behavior.

## Scope

- In scope:
  - `apps/web` hosted onboarding billing, Stripe reconciliation, billing-ref persistence, usage allowance, API route serialization, Prisma migration, join page UI, tests, and current-state docs.
  - Any Cloudflare test or compatibility patch required only if the web gate response shape is not already opaque-compatible.
- Out of scope:
  - Separate runtime enforcement wiring beyond preserving the existing signed usage gate contract.
  - Separate trial plan/product/price/budget table.
  - No-payment-method trials.

## Constraints

- Technical constraints:
  - Preserve unrelated dirty work in the current checkout.
  - Keep the implementation on the current branch and current worktree.
  - Use existing hosted billing/usage primitives where possible.
  - Persist only nullable billing-ref fields for the first migration.
- Product/process constraints:
  - Register active-plan work in the coordination ledger.
  - Use `scripts/finish-task` for the final scoped commit if overlapping dirty work allows it.
  - Run required high-risk billing/schema/UI audits before handoff.

## Risks and mitigations

1. Risk: Stripe event ordering grants paid allowance early.
   Mitigation: Keep trial-to-paid transition gated on a real non-trial `invoice.paid` event and test subscription-active-before-paid ordering.
2. Risk: Expired trial falls through to calendar Pulse allowance.
   Mitigation: Deny malformed or stale trial state before usage-period upsert/carryover.
3. Risk: Duplicate or cross-member trial activation.
   Mitigation: Use immutable redemption fields and strict metadata/customer/subscription ownership checks.
4. Risk: Overlapping dirty work in shared files.
   Mitigation: Inspect diffs before editing and keep changes narrowly additive.

## Tasks

1. Inspect current hosted billing/usage/UI code and overlapping local diffs.
2. Add offer/phase/policy constants and parsers.
3. Add Prisma fields/migration and billing-ref read/write support.
4. Implement checkout offer request validation, metadata, Stripe trial creation, and idempotency binding.
5. Implement trial activation helper shared by webhook and success reconciliation.
6. Implement invoice/subscription phase reconciliation.
7. Implement phase-aware hosted AI allowance and gate serialization.
8. Update join page product surface and docs.
9. Add/adjust focused tests.
10. Run required verification and completion audits.
11. Close plan and commit scoped changes.

## Decisions

- Trial policy versions are resolved through a server-side policy table; unknown persisted policy versions fail closed.
- `standard` is an internal checkout offer, not a public browser API value.
- Billing phase is authoritative for allowance: paid phase gets normal paid allowance even when the checkout offer records Pulse Trial history.
- Trial periods skip fallback carryover, and stale-trial usage imports are marked allowance-denied instead of being left unaccounted.
- Delayed trial checkout completion must not overwrite paid phase or an already redeemed trial marker.
- The Pulse Trial CTA and backend checkout service are default-off behind `HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED=1`.
- Stripe subscription retrieval for trial checkout events is resolved before webhook reconciliation opens its database transaction.

## Verification

- Focused Vitest passed: hosted onboarding billing/service/route/client API, Stripe checkout completion, Stripe event reconciliation, Stripe billing events, usage allowance, migration guards, and join onboarding island tests.
- `pnpm --dir apps/web verify` passed after the final robustness changes: 225 test files, 1,597 tests, lint, Prisma generate, dev smoke, and Next build.
- Completion audit findings addressed:
  - Backend now enforces the Pulse Trial rollout flag.
  - Disabled trial CTA now renders the disabled label.
  - Trial subscription retrieval for webhook processing happens before the transaction.
  - Added targeted guard tests for trial activation metadata/ownership, invoice mismatch/payment failure, malformed trial allowance state, checkout idempotency policy binding, client API payload forwarding, and migration shape.
  - `apps/web/.env.example` documents `HOSTED_PULSE_TRIAL_CHECKOUT_ENABLED`.
Completed: 2026-05-05
