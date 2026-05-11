# Murph Age Increment Evidence Card

## Goal

Add a generic aggregate-only Murph Age increment evidence card so local research runs can record whether a biomarker, wearable, or other residual layer improves a frozen anchor without authorizing product scoring, model flattening, row export, prediction export, coefficient export, or user-facing age claims.

## Scope

- Add a validator/type surface in `packages/health-metrics` for non-score-bearing increment evidence cards.
- Wire the R399 + MIDUS 2 biomarker increment runner to emit the new card for the strongest predeclared diagnostic candidate.
- Keep all outputs aggregate-only and research-local.

## Non-Goals

- No new calculator-loadable layered model card.
- No product-facing Murph Age estimate.
- No row values, participant identifiers, split memberships, predictions, coefficients, model parameters, source bodies, codebook text, or local paths in package artifacts.
- No new dataset parsing beyond the existing MIDUS 2 runner.

## Verification

- Focused `health-metrics` tests for valid and invalid evidence cards.
- Focused MIDUS increment runner tests.
- Tools typecheck for script/package integration.
- Diff-scoped repo verification before handoff.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
