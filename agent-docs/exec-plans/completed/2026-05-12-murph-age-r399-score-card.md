# Murph Age R399 Score Card

## Goal

Make the frozen NHIS/R399 anchor usable as an explicit research-only Murph Age calculator card without committing private coefficients or promoting a product score.

## Scope

- Add a score-card policy and input bundle for the R399 NHIS proxy anchor in `packages/health-metrics`.
- Add the minimal derived feature support needed by R399-style models: age squared, age-by-sex interaction, metric imputation, and metric missingness indicators.
- Preserve the existing default lab9/lab5/wearable routing unless callers explicitly request the R399 card.
- Add focused tests proving R399 can score in research mode, remains blocked in product mode, handles missing proxy metrics through imputation/missingness features, and rejects unauthorized policy drift.

## Out Of Scope

- Do not commit R399 coefficients or private local model parameters.
- Do not product-authorize R399, biomarker increments, wearable increments, risk-to-age display, or recommendations.
- Do not change hosted/web UX.
- Do not tune or mutate the frozen R399 benchmark.

## Verification

- `pnpm --dir packages/health-metrics test`.
- `pnpm --dir packages/health-metrics typecheck`.
- `pnpm test:diff packages/health-metrics/src/murph-age.ts packages/health-metrics/src/definitions/proxy.ts packages/health-metrics/src/catalog.ts packages/health-metrics/test/index.test.ts` if truthful and available.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
