# Sample Timeseries Storage

## Goal

Stop dense health samples from scaling raw manifests, audit rows, generic query entities, and search indexes linearly with every sample point.

Success criteria:

- Sample CSV and device imports persist O(1) batch provenance instead of per-row/per-sample-id arrays in raw manifests and audit records.
- Query projection no longer stores sample points as generic `query_entities` rows or FTS search documents.
- Sample summaries/search/timeline/export surfaces expose aggregate sample context without carrying every sample id.
- Focused importer/core/query/CLI tests cover the new batch-summary behavior and the dense-sample projection guard.

## Constraints

- Preserve existing canonical sample JSONL compatibility unless a test explicitly proves a safer hard cut.
- Greenfield/v1 posture: do not preserve legacy row-shaped sample provenance or old deterministic import ids.
- Do not touch unrelated hosted/runtime/web dirty work in the current checkout.
- Avoid printing raw health sample values in logs or handoff.

## Working Set

- `packages/importers/src/core-port.ts`
- `packages/importers/src/csv-sample-import-planner.ts`
- `packages/importers/test/importers.test.ts`
- `packages/core/src/mutations.ts`
- `packages/core/test/core.test.ts`
- `packages/query/src/{query-projection,search,search-shared,summaries,timeline}.ts`
- `packages/query/test/query.test.ts`
- `packages/cli/src/commands/{sample-batch-command-helpers,samples}.ts`
- `packages/cli/test/{cli-expansion-samples-audit,sample-helper-coverage,samples-add-typed-provenance,export-sample-helper-coverage}.test.ts`
- `ARCHITECTURE.md`

## State

Now: Completed and scoped for commit after GPT-5.5 review fixes, with legacy sample provenance compatibility removed for the greenfield v1 shape.
Next: None.
