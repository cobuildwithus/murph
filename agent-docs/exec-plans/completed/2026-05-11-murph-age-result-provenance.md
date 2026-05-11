# Murph Age Result Provenance

## Goal

Make Murph Age calculator outputs carry explicit scoring/provenance boundaries so research-only lab models and context-only wearable inputs cannot be mistaken for product-authorized biological-age results.

## Scope

- Add a narrow authorization/provenance receipt to Murph Age result/output types.
- Keep the existing lab9/lab5 score-bearing policy and wearable context-only policy unchanged.
- Add focused health-metrics/query tests for the output contract.

## Non-Goals

- No new score-bearing wearable model.
- No promotion of research cards to product use.
- No new dataset ingestion, benchmark mutation, or recommendation/protocol claims.

## Verification

- Focused health-metrics/query tests.
- Package diff/typecheck/smoke lane required by repo workflow.
- Security/privacy and final workflow audits required because this touches health-data output boundaries.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
