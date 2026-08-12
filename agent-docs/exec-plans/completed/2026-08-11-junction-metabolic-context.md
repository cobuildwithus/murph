# Junction metabolic context

Status: completed
Date: 2026-08-11

## Outcome

Preserve clinically useful Junction metabolic context in the canonical vault without retaining full glucose timeseries: sparse insulin administrations become medication-intake events, timed carbohydrate entries become non-meal observations, and each glucose day gains a small versioned temporal-shape envelope alongside the existing daily mean/minimum/maximum facts.

## Scope

- Normalize Junction's documented `insulin_injection` records into canonical `medication_intake` events.
- Normalize Junction's documented `carbohydrates` records into timestamped canonical observations without inventing meals.
- Extend daily glucose compaction with bounded variance/coefficient-of-variation facts and no more than 24 hourly aggregate buckets.
- Keep compact per-record/provider evidence, stable replay identity, and the existing prohibition on full timeseries arrays.
- Add exact-shape, roundtrip, replay, size-cap, and privacy regression proof plus provider compatibility documentation.

The shared resource catalog and historical-backfill policy remain the sole owner of resource admission and history. The integrated policy admits `insulin_injection` and `carbohydrates` as sparse canonical-per-record resources with 180-day initial history in bounded 30-day windows, while glucose remains aggregate-only with 14-day initial history.

## Invariants

- All queryable health data is written through the existing importer-to-core canonical path.
- No glucose sample collection or raw provider response is persisted.
- Glucose temporal evidence is versioned and capped at 24 hourly buckets per day.
- Insulin and carbohydrate records fail closed on invalid timestamps, values, or units.
- Carbohydrate events do not increment canonical meal counts.
- Evidence and logs contain no member identity, credentials, or raw provider payloads.
- Replay and overlapping fetch windows converge on stable external references.

## Work plan

1. Confirm current Junction parser, evidence, core event, metric-catalog, and sync-resource seams against the documented provider shapes.
2. Add sparse metabolic record normalization and bounded glucose temporal aggregation.
3. Add canonical roundtrip, replay, cap, malformed-shape, and no-full-timeseries tests.
4. Update Junction compatibility and runtime documentation, marking the foundation-policy dependency.
5. Merge the foundation policy/history branch, remove duplicate temporary resource arrays, run focused importer/provider/catalog tests and affected typechecks, and hand the locally committed branch back for parent-owned PR and review gates.

## Verification

- Focused Junction importer tests passed for metabolic records, glucose compaction,
  bounded temporal shape, malformed inputs, replay, and core vault roundtrip.
- Foundation policy, catalog-drift, sparse-history scheduling, and provider-side
  metabolic deduplication tests passed after integration.
- Importer, contracts, device-syncd, and health-metrics package typechecks passed.
- Health-metrics tests and importer metric-catalog coverage passed.
- Agent-doc drift and final diff/privacy checks passed.
Updated: 2026-08-11
Completed: 2026-08-11
