# Reduce query page and index overhead

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Outcome and protected invariant

Reduce restored workspace bytes beyond the first storage patch while preserving
all query rows, JSON representations, search/date filtering, rollback, and the
complete portable query SQLite cache. The source archive is inspection-only.

## Owner and evidence

The query schema owns its rebuildable storage. In-memory page-layout comparisons
identified overflow-page waste in the default 4 KiB layout for JSON-heavy rows.
Entity date predicates use COALESCE and search date predicates use substr plus
COALESCE; neither can seek through the four standalone date/occurred_at indexes.
Search candidates come from FTS rowids. Keep every index used for direct equality
or wearable range lookups. No canonical data or private fixtures are changed.

## Changes and compatibility

1. Let the existing runtime SQLite opener accept an initial page size before
   enabling WAL; leave default and read-only callers unchanged.
2. Query selects 8 KiB pages and omits four unused date indexes.
3. Schema version 31 uses the existing unsupported-cache reset and atomic
   publication paths; old runners rebuild their own derived generation.

No vacuum, new store, row codec, dependency, or maintenance loop is needed.
Page-size choice affects new databases only; existing files remain readable.
One cache rebuild is expected on version transition, with no canonical format
change or coordinated rollout. No runtime performance improvement is claimed
without the synthetic before/after benchmark.

## Verification

- Runtime opener: default unchanged, 8 KiB WAL creation, existing-file reopen,
  read-only behavior, and committed WAL-sidecar restoration.
- Query: previous-version rebuild, current-cache restore, filtered entity/search
  result parity, and representative query plans before/after removing indexes.
- In-memory row-layout size and read comparison; private archive measurements
  remain aggregate-only and in memory.
- Focused query/runtime tests, both package typechecks, complexity and diff review.
- Internal storage implementation; public changelog not applicable.

## Results

- Seven focused query files: 163 passed, one existing skipped test. Includes
  main query, date-index parity, physical storage, canonical-write concurrency,
  provider scope, source health, and projection concurrency.
- Runtime SQLite and open-failure tests: 8 passed, including committed WAL
  restoration and unchanged default/existing/read-only database layouts.
- Both package typechecks and the query dependency build passed.
- `pnpm complexity:diff` passed: no hotspots; query maximum remains 7 and the
  runtime opener maximum rises from 14 to 15 for the optional initial setting.
- Private in-memory comparison preserved all ordinary table rows and passed
  SQLite integrity checks. Alternating read comparisons covered date-filtered
  entity lists, dated FTS candidates, and metric lookup without a measured
  slowdown; this is not a disk or production-latency guarantee.
- Parent review confirmed no query predicates, output, canonical state,
  portability filters, concurrency owner, or JSON encoding changed. Four unused
  indexes are deleted, with no replacements. The SQLite opener retains its
  existing close-on-configuration-error boundary.
- Diff and privacy inspection passed. No source-archive content was written to
  fixtures, documentation, or a modified archive.
- Scope: local implementation complete; PR continuation and exact-head CI are
  tracked by the owning session. No merge or deployment is authorized.
Completed: 2026-09-21
