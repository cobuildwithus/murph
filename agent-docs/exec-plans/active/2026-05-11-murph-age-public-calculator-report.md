# Murph Age public calculator report

Status: active
Created: 2026-05-11
Updated: 2026-05-11

## Goal

- Add one public-safe Murph Age calculator report shape that can carry display status, policy state, age/risk result metadata, feature/domain attribution, and wearable bridge readiness without exposing internal point ids or row-level scaffolding.

## Success criteria

- Callers can request one report object from health-metrics/query instead of combining full internal output plus public summary manually.
- Report includes biological age/risk only when the calculator produced a result, with display summary still marking research-only or product authorization state.
- Public report strips point ids, row values, row units, wearable shadow assessment internals, predictions, coefficients, and source artifact details.
- Existing calculator scoring and product-mode abstention behavior are unchanged.

## Scope

- In scope: `packages/health-metrics` public report contracts/sanitizers and `packages/query` vault report helper/tests.
- Out of scope: authorizing research cards for product use, changing coefficients, making wearables score-bearing, or changing source/model-card loading policy.

## Constraints

- Technical constraints: derive from existing `MurphAgeCalculatorOutput`; do not duplicate scoring logic.
- Product/process constraints: keep product/research boundaries explicit and preserve health-data privacy guardrails.

## Risks and mitigations

1. Risk: report exposes internal point ids or row values.
   Mitigation: add a sanitizer allowlist and tests that inject forbidden fields before public conversion.
2. Risk: research-only age looks product-ready.
   Mitigation: carry display status, display blocked reason, and authorization flags alongside any result metadata.

## Tasks

1. Add public report/result/attribution types and sanitizer.
2. Expose health-metrics and query helper APIs.
3. Add focused tests for research, product-abstain, and sanitizer behavior.
4. Run verification/audits and close with a scoped commit.

## Decisions

- The public report may include a research result only when the internal calculator produced one, but product readiness remains determined by the display summary and authorization flags.

## Verification

- Commands to run: focused health-metrics/query coverage, focused typechecks, smoke, diff check, and required completion audits.
- Expected outcomes: checks pass; any unrelated root blocker is named.
