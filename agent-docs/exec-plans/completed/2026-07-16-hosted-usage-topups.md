# Hosted usage top-up primitive

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Specify the smallest durable usage-credit purchase primitive that lets an
  authenticated hosted member add prepaid AI usage to an existing Pulse or
  Edge plan through Stripe Checkout, while preserving a clean future owner
  boundary for group-container funding.

## Success criteria

- The spec is grounded in the current hosted billing, usage-ledger, Settings,
  assistant-handoff, and Stripe webhook owners.
- The individual-plan MVP defines the user experience, money-to-usage policy,
  durable data model, authorization, idempotency, fulfillment, refunds,
  disputes, accounting order, observability, rollout, and verification.
- The design does not depend on unreleased Stripe AI billing features and uses
  current official Stripe primitives.
- Group-container extensibility is explicit without adding speculative group
  purchase state or behavior to the MVP.
- Canonical doc indexes point to the new product spec and all touched Markdown
  is read back for consistency.

## Scope

- In scope:
  - Current-state repo and official Stripe documentation research.
  - A durable product/engineering spec for fixed-value individual-plan usage
    top-ups, initially offered at $5, $10, and $25.
  - Future group-container ownership and authorization seams needed to avoid an
    individual-only data model.
- Out of scope:
  - Runtime, database, API, Stripe Dashboard, or UI implementation.
  - Activating hard usage denial or changing current hosted plan prices.
  - Shipping group-container funding, arbitrary custom amounts, auto-recharge,
    discounts, gifting, or peer-to-peer balances.

## Constraints

- Technical constraints:
  - `apps/web` remains the owner of hosted billing and hosted usage truth.
  - Stripe is payment authority; Murph is usage-credit and consumption
    authority.
  - Fulfillment must be webhook-owned, replay-safe, and independent of the
    browser success redirect.
  - Existing subscription entitlement and included-allowance ownership remain
    separate from purchased credit.
- Product/process constraints:
  - Preserve conversation-first discovery and the narrow browser-owned payment
    confirmation exception.
  - Keep exhaustion language factual and low-pressure.
  - Prefer one composable account-credit primitive over plan-specific or
    channel-specific top-up implementations.
  - This is a docs/process-only task using the Markdown fast path.

## Risks and mitigations

1. Risk: A successful browser redirect is mistaken for paid fulfillment.
   Mitigation: Grant credit only from a verified, terminal Stripe webhook fact
   and make the local purchase/grant transaction idempotent.
2. Risk: A dollar balance ambiguously mixes cash, Stripe customer balance, and
   Murph usage value.
   Mitigation: Model a Murph-owned prepaid usage-credit ledger denominated in
   integer USD micros and keep Stripe objects as payment evidence only.
3. Risk: An individual-only schema blocks later group funding.
   Mitigation: Bind purchases and grants to the beneficiary `HostedMember.id`,
   which already represents personal members and synthetic group containers,
   while storing the private payer separately.
4. Risk: Top-ups become coercive or silently change current service behavior.
   Mitigation: Specify presentation and fulfillment now; gate any future hard
   exhaustion policy behind an explicit separately shipped rollout.

## Tasks

1. Map current hosted Stripe billing, usage accounting, Settings, assistant
   usage notice, and group-container ownership.
2. Review current official Stripe Checkout, webhook, credits, refund, tax, and
   payment-method guidance.
3. Decide the MVP payment and credit-accounting architecture and record rejected
   alternatives.
4. Write the durable product spec and update canonical indexes.
5. Read back the final Markdown diff, check references, close the plan, and
   create the scoped docs commit.

## Decisions

- The task will produce a target-state product spec, not implementation.
- The initial preset amounts are $5, $10, and $25 for individual hosted plans.
- Stripe-hosted one-time Checkout collects money; a Murph-owned append-only
  ledger owns grants, debits, refunds, disputes, and balance projection.
- Fixed packs use one Stripe Product with reusable one-time Prices. Stripe
  Billing Credits, invoice balance, Entitlements, private-preview token
  billing, and the separate advanced usage-billing stack are not v1
  dependencies.
- The durable purchase stores charged cash, granted USD-micro capacity, and a
  conversion-policy version separately even when v1 is one-for-one.
- Purchased credit is consumed after included allowance, carries across plan
  periods until used, and never creates subscription entitlement.
- One beneficiary-scoped lock serializes grants, debits, reversals, and
  cross-period carryover consumption. A web-issued operation-start credit
  watermark uses a beneficiary-scoped counter allocated and read under that
  same lock, preventing pre-purchase work from consuming a later grant;
  ambiguous late ordering is resolved conservatively in the member's favor.
- Checkout creation has a durable ambiguous-outcome fence. A lost Stripe
  response is reconciled or adopted from a frozen reconstructible request with
  the original idempotency key and can never create a second payable Session
  for the same purchase.
- Group-container funding remains future scope but uses the same beneficiary
  ledger: an authenticated personal payer may later fund the synthetic
  container's `HostedMember.id` without exposing payer identity to the group.
- Production Checkout stays disabled until a separately reviewed credit-aware
  exhaustion policy makes the purchase unlock incremental service and gives
  every accepted exhausted input an explicit route-correct terminal outcome.

## Verification

- Results:
  - Read back every touched Markdown file successfully.
  - Confirmed canonical cross-references to the new product spec.
  - `git diff --check` passed for the scoped documentation changes.
  - Identifier-leakage checks found no home-directory or local-user paths in
    the touched documentation.
  - An independent final specification review reported no findings.
  - Runtime tests and typechecking were not run because this task changes only
    Markdown documentation and follows the docs/process verification fast path.
- Commit note:
  - A scoped commit is blocked by unrelated pre-existing unmerged files in the
    shared checkout. Those files were preserved without resolution or edits.
Completed: 2026-07-16
