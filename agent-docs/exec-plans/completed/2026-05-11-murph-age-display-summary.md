# Murph Age Display Summary

## Goal

Add a pure Murph Age display/readiness summary helper so downstream UI and API callers can safely decide whether to render an age or risk value, and can distinguish selected score-bearing inputs from context-only wearable inputs.

## Scope

- Add a small exported summary type/helper in `packages/health-metrics`.
- Cover product abstention, research scoring, wearable-only context, and policy-violation outputs in focused tests.
- Keep model authorization unchanged.

## Non-Goals

- No product promotion.
- No new score-bearing wearable model.
- No new dataset, benchmark, or model-card artifact.
- No UI implementation.

## Verification

- Focused health-metrics tests and coverage.
- Typecheck and smoke per repo workflow.
- Security/privacy and completion audits because this touches health-data display boundaries.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
