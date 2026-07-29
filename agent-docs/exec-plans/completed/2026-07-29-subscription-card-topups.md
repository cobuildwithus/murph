# Reuse the subscription card for usage top-ups

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Make a user-initiated usage top-up charge the existing subscription or
  customer default card without requiring a second save-card ceremony.

## Success criteria

- A unique attached nonterminal Subscription default is attempted directly for
  a new v4 usage top-up regardless of its Checkout redisplay setting and
  outranks a conflicting generic Customer default.
- `allow_redisplay` remains limited to deciding whether Stripe may show a card
  again inside Checkout; it is not treated as card chargeability.
- Missing or ambiguous defaults and payment attempts requiring recovery still
  fall back to Stripe Checkout.
- Frozen v1-v3 behavior remains unchanged.

## Scope

- In scope: v4 saved-card resolution, focused regressions, and the current
  usage-top-up billing/security/reliability contracts.
- Out of scope: subscription pricing, payment-method management UI, automatic
  top-ups, schema changes, and historical provider state.

## Constraints

- The user explicitly initiates every top-up and sees the amount before the
  charge.
- Stripe remains the card-data owner; Murph stores no raw card details.
- The webhook remains the only usage-credit grant authority.
- Ambiguous ownership or payment-method selection fails closed to Checkout.

## Risks and mitigations

1. Risk: Multiple active subscriptions use different cards.
   Mitigation: direct charge only when their Subscription default is unique;
   otherwise use Checkout.
2. Risk: The saved card requires fresh issuer authentication.
   Mitigation: preserve the existing bounded PaymentIntent recovery and
   Checkout fallback.
3. Risk: A v4 correction changes frozen historical behavior.
   Mitigation: v4 is not deployed; retain explicit v1-v3 regression coverage.

## Tasks

1. [x] Replace the v4 redisplay filter with a Subscription-first canonical-card
   selection.
2. [x] Add limited/unspecified subscription-card, conflicting-default, and
   frozen-v3 regressions.
3. [x] Align the durable product, security, reliability, architecture, and
   operator docs.
4. [x] Run focused tests, prepared typecheck, and the required preliminary
   reviews. Exact-head final review and CI follow plan closure.

## Decisions

- A top-up click authorizes that specific charge; it does not depend on whether
  Stripe may redisplay the card in a future Checkout UI.
- Prefer a unique attached nonterminal Subscription default over the generic
  Customer default. If neither exists, use the only attached card; otherwise
  open Checkout.
- Keep v4's explicit save control for cards collected during Checkout fallback,
  because it improves future Checkout presentation without gating direct use of
  the existing subscription card.

## Verification

- Focused Vitest coverage for purchase service, reconciliation, and Stripe
  event reconciliation.
- Prepared web typecheck.
- Preliminary/final review required for the changed PR head.
- GitHub CI and non-mutating mergeability proof.
- Passed: focused usage-credit purchase, reconciliation, and Stripe-event
  Vitest coverage, 251 tests.
- Passed: `pnpm --dir apps/web typecheck:prepared`.
- Passed: local product-experience review with `NO FINDINGS`.
- Preliminary `completion-specialists` returned one accepted low coverage
  finding: the legacy unspecified Subscription-default case could pass through
  the sole-card fallback. Its exact-thread test-only patch was fully inspected,
  passed `git apply --check`, and was applied deliberately through the session
  patch owner. The focused service suite then passed 133 tests.
- Parent final review identified the actual duplicate-default seam: v3 treated
  differing Customer and Subscription defaults as ambiguous. V4 now makes the
  unique nonterminal Subscription default authoritative, retains safe fallback
  for multiple Subscription defaults, and leaves v1-v3 behavior frozen.
- Per operator direction, GitHub CI is the completion verification gate instead
  of the remaining canonical local/remote acceptance lane.
Completed: 2026-07-29
