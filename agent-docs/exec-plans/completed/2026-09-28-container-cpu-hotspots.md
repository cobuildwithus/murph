# Reduce repeated wearable projection CPU work

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

## Outcome and invariants

Reduce CPU and allocation during wearable metric projection while preserving exact
query output, source isolation, ordering, provenance, and strict canonical reads.
Canonical evidence remains authoritative; no cache, persisted schema or freshness
policy changes. Runtime cost reductions require post-deployment observation.

## Existing owners and evidence

`packages/query` owns wearable candidate deduplication and metric projection.
Exact duplicate merging currently rebuilds the growing provenance arrays on every
row, giving quadratic work for repeated observations. Metric-only projection
also computes and discards source-health summaries although the bundle owner
already supports omitting them.

## Scope and design

- Accumulate duplicate provenance once per group using insertion-ordered sets,
  retaining first-candidate fields and the existing timestamp comparison.
- Use the existing bundle option to omit unused source-health computation.
- Keep all state local to each call; inputs remain unmodified. Unique rows retain
  their original provenance arrays' contents, including repeated/blank entries.
- Do not change source admission, canonical parsing, persistent projections,
  provider ranking, or shared state ownership.
- Parent owns the independent core parser investigation, final review, commits,
  CI and ReviewGPT. No deployment is part of this task.

## Failure and evolution

Pure in-memory derivation has no new retry, rollback or deployment-skew contract.
Existing strict read failures, cancellation, cache invalidation and publication
remain with their current owners.

## Verification

- Regression tests for duplicate-heavy and unique provenance, ordering,
  first-candidate identity, source/version separation, timestamp null/empty
  behavior, and input isolation.
- Exact metric projection equality against source-health-enabled construction.
- Synthetic paired before/after CPU and wall-time benchmark with output equality,
  including unique and duplicate-heavy data and composed metric projection.
- Focused wearable/query/replica tests, query typecheck, complexity diff.

## Progress

- Implemented call-local, insertion-ordered provenance accumulation for duplicate
  groups and reused `includeSourceHealth: false` for metric-only bundle creation.
- Preserved unique-row array contents, duplicate-group whitespace semantics,
  locale-based timestamp comparison, first candidate identity and input isolation.
- Added focused regression tests and an 87-line synthetic benchmark using existing
  package benchmark tooling. No persisted state, dependency or public API added.
- Internal-only optimization: no member-visible changelog entry is appropriate.

## Local verification results

- `pnpm --dir packages/query test test/wearable-metric-dedupe.test.ts
  test/wearables-coverage-branches.test.ts test/wearables-daily-reducers.test.ts
  test/wearables-selection-shared-final.test.ts test/wearable-summary-stored-codec.test.ts
  test/wearables-sleep-session-anchor.test.ts test/browser-vault-replica.test.ts
  test/browser-vault-replica-coverage.test.ts test/query.test.ts`: 177 tests passed
  across nine files, through the shared-host verification slot.
- `pnpm --dir packages/query typecheck`: passed.
- `node scripts/run-typescript.mjs package --project
  packages/query/bench/tsconfig.json --pretty false`: passed.
- `pnpm complexity:diff`: passed. Existing metric-evidence hotspots (34 and 28)
  are unchanged; no new function exceeds 20. They encode existing qualifier and
  provenance policy, so unrelated refactoring is not warranted for this change.
- `git diff --check`: passed. No new reproducible repository friction encountered.

## Synthetic measurement

The committed benchmark was bundled against baseline `54e304e8a7f9` and the
candidate, overriding only the two changed production modules in memory for the
baseline. Each case warmed once then collected five wall/CPU samples with GC
before each timing window; full output hashes matched across revisions. Both
revision orders ran sequentially through the exclusive shared-host slot.

| Fixture | Baseline median CPU ms | Candidate median CPU ms | Interpretation |
| --- | ---: | ---: | --- |
| 8,000 exact duplicates, one group | 815–859 | 8–9 | About 99% less CPU |
| 8,000 candidates, 80 duplicate groups | 27–29 | 8–10 | About 67–68% less CPU |
| 8,000 unique candidates | 7 | 6–7 | No material regression detected |
| Full projection, one day, three providers, 2,000 copies each | 243 | 76 | About 69% less CPU; concentrated stress case |
| Full projection, 90 days, three providers, 20 copies each | 82–86 | 80–82 | About 2–4% less CPU |
| Full projection, 365 days, three providers, unique rows | 64–65 | 57–64 | Run-order variation; no reliable general saving claimed |

The burst case was added for the reverse-order run; its complete projection wall
median fell from 214 to 54 ms. Ordinary history and burst scenarios include the
same metric extraction and provenance as production. These are in-memory local
measurements, not container billing or a promise of 10–20% overall savings.
Canonical I/O, production duplicate frequency, wakeups and end-to-end runtime
remain unmeasured here. Parent owns required CI, ReviewGPT and PR completion.
Completed: 2026-09-28
