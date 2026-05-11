# Murph Age Wearable Shadow Assessment

Status: completed
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Make the wearable shadow-increment policy executable as an assessment surface in `@murphai/health-metrics`.
- Given lab-anchor plus wearable inputs, report which wearable families are ready for research shadow evaluation without authorizing them to affect the Murph Age score.

## Success Criteria

- Calculator output includes wearable shadow assessments only when a score-bearing lab/BP/body anchor is selected.
- Each shadow assessment reports selected metric keys/point ids, missing required quality or signal keys, and readiness status without exposing values, units, predictions, coefficients, or row data.
- Activity, sleep, resting-heart-rate, and HRV remain non-score-bearing, non-product-authorized, and risk-effect-not-estimated.
- Tests cover ready and not-ready shadow families and prove existing lab score output remains invariant.

## Scope

- In scope:
  - `packages/health-metrics/src/murph-age.ts`
  - `packages/health-metrics/test/index.test.ts`
  - `packages/query/src/murph-age.ts` type adaptation for the extended calculator output contract
  - This plan and the coordination ledger row.
- Out of scope:
  - Training a wearable model.
  - Product display of wearable increments.
  - Query package or UI wiring.
  - Dataset ingestion or benchmark execution.

## Constraints

- Keep the surface metadata-oriented and clone-safe.
- Do not promote wearables into score-bearing model cards.
- Do not introduce new persisted state.
- Do not expose health row values or model internals.

## Verification

- Passed: `pnpm --dir packages/health-metrics test -- test/index.test.ts`
- Passed: `pnpm --dir packages/health-metrics test:coverage`
- Passed: `pnpm --dir packages/query test -- test/murph-age-runtime.test.ts`
- Passed: `pnpm --dir packages/query test:coverage`
- Passed: `pnpm typecheck`
- Passed: `pnpm test:smoke`
- Passed: scoped `git diff --check`

## Review

- R934 Pro lab/wearable strategy supported constrained wearable shadow increments over a frozen lab/BP/body anchor, with wearables remaining non-score-bearing until family-specific hard-outcome validation.
- Completion audit found no blocking issues. Residual non-blocking gap: query runtime coverage does not directly assert a vault-backed lab-anchor plus wearable case returns non-empty shadow assessments; the behavior is covered in `@murphai/health-metrics`.
Completed: 2026-05-11
