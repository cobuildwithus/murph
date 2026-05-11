# Murph Age MIDUS-to-CRELES Transport Benchmark

## Goal

Add a local research runner that trains the existing MIDUS 2 compact lab5 no-CRP model card, scores compatible complete-case CRELES rows, and emits only aggregate transport-stress metrics.

## Scope

- Add `scripts/murph-age/midus2-creles-transport-benchmark.ts`.
- Add focused synthetic fixture coverage for aggregate-only output, CLI output, and egress guards.
- Preserve the frozen NHIS/R399 anchor direction; this runner only tests whether a biomarker increment trained in MIDUS survives in CRELES.

## Non-Goals

- No product-facing Murph Age promotion.
- No ReviewGPT gate or small checklist review.
- No row-level output, participant identifiers, split memberships, predictions, coefficients, source bodies, codebook text, or model parameters in tracked artifacts.
- No CRP/hsCRP/PCR feature execution.

## Verification

- Focused Vitest runner test.
- Tooling typecheck.
- Live local run against downloaded study packages, aggregate-only output.
- Required completion audits for health-data/privacy boundary.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
