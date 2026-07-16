# Hosted usage top-up implementation

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Ship personal hosted-plan usage top-ups end to end: an eligible Pulse or Edge
  member can choose $5, $10, or $25 in Settings, pay through Stripe-hosted
  Checkout, receive durable purchased usage credit only after authoritative
  payment reconciliation, and resume blocked hosted usage without losing the
  accepted input that encountered the limit.
- Establish the smallest beneficiary-owned credit primitive that can later fund
  a synthetic group container without coupling payer identity, personal plan
  state, or Stripe objects to the eventual group runtime.

## Success criteria

- Included plan allowance remains the first source consumed; purchased credit is
  consumed only after included allowance is exhausted and carries forward until
  used.
- One append-only credit ledger is canonical, one compact member projection is
  the bounded hot-path read, and all grant/consume/reversal mutations serialize
  under the beneficiary owner.
- Checkout creation accepts only the committed $5/$10/$25 catalog and an
  authenticated eligible personal beneficiary. The browser redirect never
  grants credit.
- Stripe webhook reconciliation is replay-safe and grants each paid purchase at
  most once; delayed payment, expiry, refund, and dispute events converge to a
  deterministic local state without exposing provider secrets or payer data.
- Usage-limit enforcement blocks subsequent provider work, preserves accepted
  conversation input as pending, and a verified credit grant requests an
  immediate normal recheck so work can resume.
- Settings shows the current included and purchased usage state, exposes an
  accessible responsive top-up dialog, and presents checkout return states as
  pending/verified/canceled rather than treating a success query as payment
  proof.
- Focused unit, integration, migration, and browser checks pass; required repo
  verification, frontend review, ReviewGPT, and PR CI complete successfully.

## Scope

- In scope:
  - Personal paid Pulse and Edge beneficiaries.
  - Fixed USD offers of $5, $10, and $25.
  - One-time Stripe-hosted Checkout Sessions and existing webhook ingress.
  - Durable purchase, ledger, projection, refund/dispute compensation, usage
    admission/settlement, settings projection/action, and limit-state UX.
  - A beneficiary type/id seam whose initial implementation accepts personal
    hosted members only.
  - Compatibility-safe schema expansion and documented deployment ordering.
- Out of scope:
  - Group-container checkout UI or group participant authorization.
  - Arbitrary/custom amounts, recurring auto-reload, saved-payment charging,
    invoicing, Stripe metered billing, coupons, tax configuration, or Connect.
  - Replacing existing subscription billing or changing base plan prices and
    included allowances.

## Constraints

- Technical constraints:
  - Postgres/web remains the product-state owner; Stripe is payment evidence,
    and assistant/runtime state is never canonical billing state.
  - Reuse the existing Stripe client, webhook receipt owner, hosted-access gate,
    mailbox/recheck mechanism, and Settings component system.
  - Do not mutate the derived base allowance limit to represent purchased
    credit, add a second runtime gate, add a billing queue, or introduce a new
    dependency.
  - Every provider effect uses a stable local request identity and explicit
    ambiguous-outcome reconciliation; all money values use integer minor units
    and usage values use existing integer micro-dollar units.
  - Schema expansion must remain compatible with the currently deployed web
    build if a later build fails after migration.
- Product/process constraints:
  - Usage exhaustion is blocking product behavior; checked-out advisory behavior
    must be corrected at its single historical owner.
  - Preserve accepted inbound work and all product-critical reply/onboarding,
    billing/access, auth, privacy, and safety flows.
  - Keep payer and beneficiary separate and expose no payer identity in future
    shared-container projections.
  - Use the existing Base UI/shadcn visual language, warm-paper design tokens,
    restrained motion, and accessible keyboard/mobile behavior.

## Risks and mitigations

1. Risk: duplicate or out-of-order Stripe events double-grant or mis-reverse
   credit.
   Mitigation: stable purchase/event identities, receipt-owned retry, unique
   ledger source keys, beneficiary serialization, and replay/out-of-order tests.
2. Risk: an ambiguous Checkout create call produces multiple payable sessions.
   Mitigation: claim and freeze one local purchase request before egress, use a
   stable Stripe idempotency key, and reconcile the recorded request/session
   before any replacement attempt.
3. Risk: concurrent usage settlement and credit grant overspend or hide balance.
   Mitigation: update the canonical ledger and compact projection in one
   beneficiary-locked transaction with explicit version/amount invariants.
4. Risk: deployment skew blocks work before the credit-aware consumer is live.
   Mitigation: keep schema additive, identify compatibility behavior explicitly,
   and document/deploy the runtime consumer before enabling the web purchase UI
   if both planes must change.
5. Risk: browser return copy falsely promises credit before webhook delivery.
   Mitigation: status is read from authenticated local reconciliation state and
   remains visibly pending until an authoritative grant exists.

## Tasks

1. Map current owners and historical gate behavior; freeze data model and
   compatibility boundary.
2. Add additive Prisma schema/migration for purchases, append-only credit
   entries, and compact personal-member projection.
3. Implement beneficiary-serialized grant, consumption, reversal, projection,
   and invariant helpers; integrate them into allowance resolution/settlement.
4. Restore the single blocking hosted usage gate and normal pending-input
   recheck behavior.
5. Add the fixed offer catalog, authenticated Checkout creation/status surface,
   and webhook-authoritative payment/refund/dispute reconciliation.
6. Add Settings usage projection, top-up dialog, redirect/return handling, and
   exhausted-state entry points.
7. Add focused unit, route, webhook, database/concurrency, runtime, migration,
   and component/browser coverage.
8. Update architecture, security, reliability, verification, env, and product
   docs to match the shipped trust boundary and rollout contract.
9. Run scoped/full verification, frontend and required completion audits,
   privacy scans, commit/push, open the implementation PR, then run ReviewGPT
   concurrently with CI until both are clean.

## Decisions

- Use Stripe-hosted one-time Checkout Sessions, not Stripe metered billing or a
  custom card form.
- Keep the docs-only PR immutable and supersede it with a fresh implementation
  PR so ReviewGPT's first reviewed head covers the complete production change.
- Treat the append-only credit ledger as canonical and a compact member balance
  as a rebuildable hot-path projection; do not overload the base allowance
  period's derived limit.
- Model payer and beneficiary independently at the purchase boundary, while
  limiting the initial beneficiary resolver to personal hosted members.

## Verification

- Commands to run:
  - Focused Vitest suites for usage accounting, Stripe Checkout/webhooks,
    settings projection/actions, and runtime limit admission.
  - Focused real-Postgres concurrency/replay tests using the repo's guarded local
    database lane when available.
  - `pnpm test:diff` and any broader checks routed by the completion workflow.
  - Hosted web typecheck/build/lint through the required app verification lane.
  - Desktop and mobile Settings browser proof with local provider stubs.
  - Required frontend, security/privacy, and completion audit passes.
  - ReviewGPT on the exact pushed implementation head, run concurrently with PR
    CI and repeated only for substantive PR-specific remediation.
- Expected outcomes:
  - All checks pass with no secret/identifier leakage, no unexplained generated
    artifacts, and no unrelated working-tree changes.
  - Replay, concurrency, delayed webhook, refund/dispute, exhausted admission,
    and post-grant recheck tests prove the durable behavior.
  - ReviewGPT returns a credible exact-head PASS and required PR checks are
    green.
Completed: 2026-07-16
