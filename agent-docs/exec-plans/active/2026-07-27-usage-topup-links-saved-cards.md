# Direct usage top-up handoffs and saved cards

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

Let an eligible member ask Murph for the exact first-party page that opens the correct personal or Family-owner usage picker, and let personal, Family, and group top-ups reuse one unambiguous saved Stripe card after one explicit fixed-amount confirmation.

## Success criteria

- An explicit paid personal-plan request receives the canonical Settings deep link even when proactive low-usage recommendation thresholds are not met.
- An active Family owner can receive a server-owned self top-up link that opens the picker for the owner's own active Family seat; non-owners, inactive billing, missing owner rows, and non-owner member targets receive no direct payable handoff.
- Settings treats the query parameter only as a navigation hint, reauthorizes the current Family owner and active owner seat server-side, and opens at most one intended top-up dialog.
- New personal, Family, and group purchases try one canonical saved card and fall back to Stripe Checkout only when card collection or customer authentication is required.
- Existing v1 and v2 in-flight purchases retain their frozen request shape and retry behavior; no migration, card table, wallet, recurring charge, queue, or second ledger is added.
- Browser return state never grants usage; verified Stripe webhook reconciliation remains the sole grant authority.
- Focused package/Web tests, typechecks, lint/build coverage, design-catalog proof, product review, preliminary specialist review, final ReviewGPT, and exact-head CI complete or any concrete blocker is reported.

## Scope

- In scope: private-assistant handoff guidance, Settings owner-self targeting and initial dialog state, shared top-up dialog copy, purchase-policy evolution, saved-card attempt eligibility for all current target kinds, Checkout future-use setup, focused tests, design catalog, and current owner docs.
- Out of scope: chat-selected amounts, chat-created charges, automatic or recurring top-ups, arbitrary amounts, stored card data, anonymous funding, a shared Family wallet, model-composed member identifiers, non-owner Family-member deep links, new payment endpoints, new purchase states, schema changes, or changes to subscription billing.

## Proven gaps

- The personal Settings URL already exists, but assistant guidance sends it only through a threshold-gated recommendation path instead of after an explicit eligible request.
- Family guidance returns generic Settings navigation even after proving the requester is the active owner asking about the owner's own seat.
- `continueHostedUsageCreditCheckout` tries the saved-card PaymentIntent only for group targets; personal and Family purchases always create Checkout.
- Checkout intentionally saves a newly entered card only for current-policy group returns, so a personal or Family top-up cannot establish the reusable card path.

## Constraints

- Keep `apps/web` authoritative for payer, beneficiary, target authorization, offer, purchase, payment binding, grant, refund, and dispute reconciliation.
- A link may navigate to an amount picker but must never select an offer, authorize a charge, or weaken authenticated mutation checks.
- Every top-up remains one explicit fixed-amount action. Murph never chooses the amount or claims payment completed.
- Preserve the purchase row and existing status lifecycle as the only ambiguity fence.
- Prefer one target/policy helper over target-specific branches and preserve old-policy reconstruction byte-for-byte.
- Use a stable server-interpreted Family-owner-self selector rather than exposing internal group/member identifiers to the model.

## Risks and mitigations

1. Risk: a crafted query parameter could open or pay for a stale/foreign Family target.
   Mitigation: the selector means only “my current Family owner seat”; Settings resolves it from the authenticated current snapshot, and the existing POST transaction repeats payment authorization.
2. Risk: widening direct card use could change retries for an in-flight v2 purchase.
   Mitigation: introduce v3 policy semantics and keep v1/v2 target support frozen.
3. Risk: a direct attempt that may have succeeded could fall through to Checkout and double-charge.
   Mitigation: reuse the existing persist-before-confirm binding, exact-intent recovery, and provider-proven cancellation gates unchanged.
4. Risk: saved-card wording could hide that one click charges immediately.
   Mitigation: describe saved-card use before the action and label the exact-amount action as the authorization.
5. Risk: active mobile Family-settings work overlaps the same surface.
   Mitigation: render one standalone triggerless deep-link host from Settings and avoid restructuring Family tables or management dialogs.

## Tasks

1. Register the plan and inspect the exact current owner contracts, tests, and design-catalog states.
2. Add personal and Family-owner-self handoffs with strict current-target resolution.
3. Evolve the frozen purchase policy and reuse the existing saved-card lifecycle across all current target kinds.
4. Update user-facing confirmation copy, the design catalog, current owner docs, and focused regression coverage.
5. Push an exact candidate, run available focused/CI verification and required review gates, resolve findings, close the plan/ledger, and open the final PR.

## Decisions

- Keep `/settings?addUsage=true#subscription` for personal handoff and use `/settings?addUsage=family#family` as a stable owner-self selector.
- Do not put Family member or group identifiers in the model-facing URL; arbitrary member management remains inside authenticated Family Settings.
- Use purchase policy v3 for target-neutral saved-card and Checkout-save behavior while retaining v1/v2 reconstruction.
- Keep the existing saved-card resolver and direct PaymentIntent lifecycle unchanged unless focused proof exposes a target-specific assumption.
