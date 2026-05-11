# Murph Age R399 Layering Readiness

## Goal

Add a narrow research-side readiness artifact that answers whether the frozen NHIS/R399 anchor can be treated as the base layer for biomarker or wearable increments, using only aggregate-safe metadata and existing local research outputs.

## Scope

- Add a script under `scripts/murph-age/` that reads the ignored local R399 parameter artifact and latest aggregate MIDUS/CRELES research outputs.
- Emit an aggregate-only readiness JSON under ignored `.runtime/operations/research/murph-age/model-runs/`.
- Preserve the current product boundary: no product authorization, no score promotion, no row values, no predictions, no coefficients, no paths, no source bodies.
- Add focused tests for aggregate-only behavior, missing-artifact handling, and promotion-gate interpretation.

## Out Of Scope

- Do not add a user-facing product model.
- Do not commit R399 coefficients or private model parameters.
- Do not change the `murph-age` CLI command shape.
- Do not tune R399, MIDUS, CRELES, or any inspected benchmark split.

## Verification

- Focused Vitest for the new runner.
- `pnpm exec tsc -p tsconfig.tools.json --pretty false`.
- Diff-aware scoped verification if the change remains limited to `scripts/murph-age/**`.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
