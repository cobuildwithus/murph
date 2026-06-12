# query-projection-drop-dead-columns

Status: completed
Created: 2026-06-11
Updated: 2026-06-11

## Goal

- Shrink the rebuildable query projection (`vault/.runtime/projections/query.sqlite`) by removing the `provenance_json` and `context_json` columns from `query_metric_points`. Both columns are written on every metric point but never read anywhere; the same data is already embedded verbatim inside `metric_point_json` (the only column the read path uses). On a real member vault this dead weight is ~1.6MB raw (~10-12% of the projection file).

## Success criteria

- `query_metric_points` schema and insert no longer include `provenance_json` / `context_json`.
- `QUERY_PROJECTION_SQLITE_VERSION` bumped 6 -> 7 so existing projections are deleted by `resetUnsupportedQueryProjection` and rebuilt with the new shape (the projection is fully rebuildable from canonical evidence; no migration needed).
- `pnpm test:diff packages/query packages/cli` (or owner coverage) green.
- No remaining references to the dropped columns in source or tests.

## Scope

- In scope: `packages/query/src/projection/schema.ts`, `packages/query/src/projection/metric-store.ts`, test helpers in `packages/query/test/{query,murph-age-runtime}.test.ts` and `packages/cli/test/murph-age-command.test.ts` that hand-roll the same INSERT.
- Out of scope: wearable summary JSON compaction (empty-envelope omission, reasons trimming), snapshot policy (projections are already excluded from hosted workspace snapshots), any canonical/ledger format change.

## Constraints

- Technical constraints: projection version bump must flow through the existing `user_version` seam; read-only opens skip migrations, and `resetUnsupportedQueryProjection` deletes mismatched DBs before the only write-mode open (`rebuild.ts`).
- Product/process constraints: no behavior change to query output; `listStoredMetricPoints` returns parsed `metric_point_json` only.

## Risks and mitigations

1. Risk: some reader of the dropped columns exists outside `packages/query`.
   Mitigation: repo-wide grep shows the only references are the schema, the insert, and three test helpers that mirror the insert; updated together.
2. Risk: an existing v6 projection opened for write without a prior reset would migrate via CREATE IF NOT EXISTS and keep the old NOT NULL columns, breaking the new narrower INSERT.
   Mitigation: the only `create: true` open is in `rebuild.ts`, which always runs `resetUnsupportedQueryProjection` first; version mismatch deletes the file.

## Tasks

1. Drop the two columns from `ensureQueryProjectionSchema` and `insertMetricPoints`; bump `QUERY_PROJECTION_SQLITE_VERSION` to 7.
2. Update the three test helpers that duplicate the INSERT column list.
3. Run owner coverage and required completion audits.

## Decisions

- Keep the extracted scalar columns: they back the metric/biomarker/date indexes and filters.
- Do not attempt the larger wearable-summary compaction here; it touches the read path's typed decode and is reported separately as a follow-up option.

## Verification

- Commands to run: `pnpm test:diff packages/query packages/cli`, focused typecheck.
- Expected outcomes: green; rebuilt projection contains no `provenance_json`/`context_json` columns and `user_version` 7.
Completed: 2026-06-11
