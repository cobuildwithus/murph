# Murph Age Primary Bundle Resolver

## Goal

Refactor `calculateMurphAgeFromInputBundle` so primary score-bearing bundle selection flows through a small policy resolver, without changing calculator behavior.

## Scope

- Keep current Lab9, Lab5, R399, wearable-context, function-context, and abstention behavior unchanged.
- Preserve product/research authorization gates and wearable shadow assessment behavior.
- Add focused tests that lock the explicit R399 override and ordinary auto-bundle paths.

## Non-Goals

- No new score-bearing model.
- No product authorization changes.
- No new dataset, model-card, or source-route changes.

## Verification

- Focused `health-metrics` tests.
- Health-metrics typecheck.
- Tools typecheck if script/package exports are touched.
- Diff check before handoff.
Status: completed
Updated: 2026-05-12
Completed: 2026-05-12
