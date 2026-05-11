# R399 Local Model-Card Export

## Goal

Make the frozen R399 NHIS research anchor loadable by the existing Murph Age calculator in explicit local research mode, without committing private coefficients, row values, predictions, participant identifiers, or local paths.

## Scope

- Add a local exporter that converts the ignored R399 private-runtime parameter artifact into the existing ignored model-card artifact shape.
- Validate the exported artifact against the committed R399 research-only policy.
- Update the R399 readiness summary so the calculator score-path gate can pass only when both the committed policy and ignored local model-card artifact are present.
- Add focused tests for privacy boundaries, feature allowlist validation, artifact parsing, and readiness behavior.

## Non-Goals

- Do not promote R399 to product-facing status.
- Do not add wearable or biomarker score-bearing increments.
- Do not print or commit model coefficients, row values, predictions, identifiers, local paths, source bodies, or data dictionaries.
- Do not touch unrelated hosted runner/runtime/CLI work.

## Verification Plan

- Focused Vitest coverage for the new exporter and updated readiness runner.
- `pnpm test:diff` over the touched Murph Age script/test files.
- Privacy/egress checks through existing aggregate egress helpers and committed artifact review.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
