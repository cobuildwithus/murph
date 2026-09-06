---
title: 'Bounded daily runtime event inventories exceed the diagnostic query budget'
severity: 'minor'
issue: 'cobuildwithus/murph#2996'
---

## Expected Behavior

An approved read-only diagnostic can inventory one event family across a bounded day and return only aggregate outcomes, with a documented fallback when the normal query budget cannot cover that window.

## Current Behavior

Repeated day-sized outbox event aggregates hit the statement timeout. Four-hour slices complete, leaving the broader inventory partial unless the operator manually subdivides it. The runtime-log schema declares subject/recent, attempt/event/time, and retention/time indexes; it does not declare an event-leading index for this cross-subject inventory. The index shape is a possible contributor, not a proven query-plan diagnosis.

## Possible Solution

Measure the query plan and runtime with a representative synthetic log volume. Document an efficient bounded event-inventory query or paging recipe with explicit completeness accounting. Evaluate index cost only after that proof; do not raise production statement budgets as a workaround.

## Minimal Reproducible Example

In an isolated diagnostic test database with representative synthetic event volume, compare this one-day aggregate with six adjacent four-hour slices:

```sql
SELECT count(*)
FROM hosted_runtime_log
WHERE at >= TIMESTAMPTZ '2030-01-01T00:00:00Z'
  AND at < TIMESTAMPTZ '2030-01-02T00:00:00Z'
  AND event_code = 'outbox.delivery_finished';
```

Record timing and the query plan under the same bounded statement budget. This is a synthetic reproduction recipe; no local load fixture or index experiment has been run yet.

## Context

This limits aggregate completeness during runtime investigations and forces repeated window subdivision. Keep production content, identities, raw logs, and connection configuration out of the report. Relevant owner: `apps/web/prisma/runtime-logs/schema.prisma` and the hosted runtime diagnostic guidance.
