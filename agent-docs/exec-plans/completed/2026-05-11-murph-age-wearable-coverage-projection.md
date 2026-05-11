# Murph Age Wearable Coverage Readiness

## Goal

Derive report-time wearable coverage-quality metric points from canonical wearable summaries so Murph Age can distinguish partial wearable context from ready bridge context.

## Scope

- Add query/report logic for 28-day valid activity-day counts, valid sleep-night counts, and coverage index anchored to the report `asOf`.
- Add a focused CLI regression showing canonical wearable observations can produce ready bridge context while remaining non-score-bearing and non-product-authorized.
- Preserve public-output boundaries: no raw values, point IDs, participant identifiers, product claims, recommendations, or protocol claims.

## Out of Scope

- Product authorization, user-facing biological age display, recommendations, or protocol tracking.
- New model science, ReviewGPT micro-gates, or source/dataset ingestion.
- New wearable provider importers.

## Verification

- Focused Murph Age CLI test.
- Query/CLI typecheck and targeted diff verification.
- Required repo checks/audits per workflow.

## Status

Active.
Status: completed
Updated: 2026-05-11
Completed: 2026-05-11
