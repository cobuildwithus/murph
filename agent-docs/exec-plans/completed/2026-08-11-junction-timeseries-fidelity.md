# Preserve bounded Junction timeseries shape

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

Preserve enough bounded intraday shape from the currently admitted Junction
glucose, blood-oxygen, stress, caffeine, water, and mindfulness resources for
causal and episode-oriented analysis without retaining provider firehoses or
creating a second canonical owner.

## Proven gap

- Glucose currently lands only daily mean, minimum, and maximum facts.
- Blood oxygen currently lands only daily mean and minimum facts.
- Stress currently lands only a daily mean fact.
- Caffeine, water, and mindfulness currently land only daily sums.
- The existing importer already receives timestamps and normalized values but
  discards intraday ordering after daily reduction.
- Canonical metric queries can already retrieve instant observation and
  measurement facts, so the importer/core/query path can be extended without a
  new store, service, queue, or runtime state owner.

## Success criteria

- Existing daily facts remain stable and replay-safe.
- Dense resources retain compact, resource-specific daily feature envelopes
  and only the bounded canonical facts needed to query their important shape.
- Sparse intake/session resources retain one timestamped canonical fact and one
  compact evidence artifact per valid source record while keeping their current
  daily totals.
- Identical glucose mean/min/max fixtures with different temporal shapes
  produce different time-in-range or excursion evidence.
- Blood-oxygen fixtures distinguish an isolated low reading from a sustained
  low interval.
- Stress retains bounded episode and hourly-distribution evidence.
- No full provider sample array, provider credential, direct identifier, or
  private real-world fixture is retained or committed.
- The maximum per-day artifact and canonical-record cardinality is explicit and
  deterministically tested.
- Focused importer, core round-trip, query, and typecheck proof passes; required
  exact-head CI and ReviewGPT gates are green.

## Architecture

- `packages/importers` remains the sole normalization owner and derives the
  bounded shape in memory from already-fetched Junction records.
- `packages/core` remains the sole canonical writer through the existing device
  batch import boundary.
- Daily aggregates remain canonical observations.
- Sparse source records reuse existing point-in-time measurement semantics.
- Dense resource envelopes reuse the existing versioned evidence-part seam and
  expose only genuinely query-needed scalar facts through existing canonical
  event shapes.
- `packages/query` and `packages/health-metrics` change only where a missing
  public metric definition or retrieval proof is required; no new persisted
  query owner is introduced.

## Tasks

1. Trace current importer grouping, stable identity, evidence retention, core
   validation, and metric-query behavior for the six resources.
2. Ask ReviewGPT to implement the smallest composable patch and return an
   attachment-based diff with focused tests.
3. Inspect the complete returned patch, reject speculative abstractions, and
   integrate only changes that preserve owner and bounded-load invariants.
4. Add or correct deterministic fidelity, replay, cardinality, core round-trip,
   and query proof.
5. Run focused verification, push the exact candidate, complete preliminary and
   final ReviewGPT gates with CI, and close this plan in the final scoped commit.

## Deployment and rollback

- Canonical writes are additive and must remain readable by existing query
  code during rolling deployment.
- Older runtimes may continue writing only daily facts; newer runtimes add
  bounded artifacts and facts without requiring a migration.
- Rollback stops new enriched writes but leaves already-written strict canonical
  records readable through the existing event contract.
Completed: 2026-08-11
