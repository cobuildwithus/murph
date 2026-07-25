# Paid usage allowance at eighty percent

Status: active
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Set each paid member's monthly included AI usage to 80% of the recurring amount paid for that member's plan.

## Success criteria

- Direct Pulse members receive $6.40 of included monthly usage from the $8 plan.
- Direct Edge members receive $16.00 of included monthly usage from the $20 plan.
- Family-sponsored Pulse members receive $5.60 from the $7 seat price, and Family-sponsored Edge members receive $15.20 from the $19 seat price.
- Trial and thread-container limits remain unchanged.
- Existing members keep any higher allowance already granted for their open paid period, and renew into the new limit without a migration or second state owner.
- Focused coverage, canonical verification, required product review, preliminary specialist review, final ReviewGPT, CI, and mergeability proof pass.

## Scope

- In scope: hosted billing-plan allowance derivation, direct and Family allowance resolution, focused regressions, and current hosted billing product documentation.
- Out of scope: plan prices, trial allowances, purchased usage credit, Stripe checkout or invoice behavior, thread-container budgets, schemas, and historical usage records.

## Constraints

- Derive allowance from the existing server-owned recurring price catalog.
- Keep direct and Family seat pricing distinct because the same Pulse or Edge tier has different recurring prices in those two billing modes.
- Preserve included-first settlement, purchased-credit ownership, and the current persisted-period convergence path.
- Add no migration, provider call, configuration knob, or new persisted state.

## Risks and mitigations

1. Risk: reusing the direct price for Family seats would grant the wrong allowance.
   Mitigation: expose separate direct-plan and Family-seat allowance helpers from the billing catalog and cover all four plan/mode combinations.
2. Risk: lowering an allowance mid-period could abruptly block a member who still had granted capacity.
   Mitigation: preserve a higher same-plan limit for the open paid period, then prove the following period starts at 80%; keep actual plan, tier, and billing-mode changes immediate.
3. Risk: unrelated fixed values for trials, malformed provider usage, purchased packs, or test scaffolding could be changed accidentally.
   Mitigation: change only paid-plan allowance derivation and its behavior-specific assertions; leave other fixed limits intact.
4. Risk: preserving the rollout limit could accidentally prevent a same-tier direct-to-Family conversion from taking effect.
   Mitigation: force reconciliation through the existing allowance owner at the canonical Family webhook handoff and cover Pulse and Edge conversions with unchanged period bounds.

## Tasks

1. Replace duplicated fixed paid-plan allowance values with an exact 80% derivation from the server-owned direct and Family recurring prices.
2. Route Family sponsorship through the Family-seat allowance helper while keeping direct paid plans on the direct helper.
3. Add focused regressions for the four recurring prices and existing-period convergence.
4. Update the current hosted plan-usage and Family product specs.
5. Run canonical verification and a direct calculation/current-period scenario.
6. Complete product-experience review, preliminary coverage review, parent final review, final ReviewGPT, CI, and mergeability proof.
7. Close the plan, create the final scoped commit, push, and hand off the PR.

## Decisions

- Interpret “whatever they paid” as the server-owned recurring plan or seat amount currently charged by Murph: $8/$20 for direct plans and $7/$19 for Family seats. Discounts, taxes, prorations, purchased credit, and trial value remain outside this allowance rule because they are not current allowance-owner inputs.
- Use integer cents and USD micros, so every current catalog price produces an exact allowance with no floating-point rounding.
- Preserve a higher allowance already granted for the same open paid period, then apply the 80% rule at renewal. Real plan, Family tier, and direct-to-Family billing-mode changes still reconcile during the current period.

## Verification

- Pending.
