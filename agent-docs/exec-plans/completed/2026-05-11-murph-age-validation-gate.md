# Murph Age validation gate authorization

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Add a health-metrics-owned validation gate so future Murph Age model cards cannot become product-facing by flipping `productAuthorized` or `riskToAgeDisplayAuthorized` alone.

## Success criteria

- Every model-card policy carries an explicit validation-gate summary.
- Product/risk-to-age authorization is computed through helpers that require a passed validation gate plus product-promotion evidence.
- Current research cards remain blocked for product mode.
- Tests prove blocked gates override raw product booleans and passed gates can authorize only through the explicit helper path.

## Scope

- In scope:
  - `packages/health-metrics/src/murph-age.ts`
  - `packages/health-metrics/test/index.test.ts`
- Out of scope:
  - Training or promoting a new Murph Age model.
  - Changing user-facing recommendations or protocol claims.
  - Routing this small invariant through ReviewGPT.

## Constraints

- Technical constraints:
  - Keep ownership inside `health-metrics`; query and UI consumers should receive already-computed authorization.
  - Preserve current public-safe calculator reports and research-mode behavior.
- Product/process constraints:
  - Risk prediction remains research-only until external/product validation is explicitly passed.
  - No source rows, participant data, model coefficients, or private identifiers in docs, tests, or logs.

## Risks and mitigations

1. Risk: The gate becomes a second large policy system.
   Mitigation: Keep it to a compact status/evidence summary and two helper predicates.
2. Risk: Tests accidentally bless a current card as product-ready.
   Mitigation: Use helper-level fixtures for the positive path and assert all current cards remain blocked.

## Tasks

1. Fill model-card policies with blocked validation-gate summaries.
2. Compute effective product and risk-to-age authorization from the validation gate.
3. Add focused health-metrics tests for current blocked cards and helper behavior.
4. Run health-metrics verification plus required completion audits.
5. Close the plan with `scripts/finish-task` if verification is clean.

## Decisions

- Effective product authorization requires both the raw policy intent flag and a passed validation gate with product-promotion evidence.
- Effective risk-to-age display authorization additionally requires raw `riskToAgeDisplayAuthorized`.

## Verification

- Commands to run:
  - `pnpm --dir packages/health-metrics typecheck`
  - `pnpm --dir packages/health-metrics test:coverage`
  - `pnpm typecheck`
  - `pnpm test:smoke`
- Expected outcomes:
  - All commands pass or any unrelated pre-existing failures are documented with scoped evidence.
Completed: 2026-05-11
