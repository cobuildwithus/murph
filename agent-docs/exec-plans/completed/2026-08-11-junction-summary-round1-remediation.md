# Junction summary ReviewGPT round-one remediation

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Resolve all round-one findings on PR #1702 while simplifying menstrual normalization, preserving source-instance identity, and making the new activity facts queryable under an activity-owned metric family.

## Invariants

- No full Junction timeseries arrays, sample rows, or provider-shaped menstrual arrays persist.
- Actual/canonical menstrual data wins admission before newest valid dates; deterministic hashes only break ties and missing dates sort last.
- Distinct source instances keep distinct canonical resource identity without exposing opaque source identifiers in retained evidence.
- Menstrual evidence and canonical events derive from the same bounded admitted flat facts.
- Activity and sleep heart-rate facts cannot alias in query projection.
- Existing core canonical revision/tombstone ownership and exact replay behavior remain intact.
- PR #1702 keeps `a54a0a10d185c368ad4f04f0678fb84f0fe07f01` as its immutable first-reviewed head.

## Architecture

- Delete the provider-array reconstruction layer. A prepared cycle keeps only sanitized scalar fields, resolved opaque origin identity for runtime use, and admitted flat facts.
- Extend the existing health-metric catalog and wearable activity projection with explicit activity-owned metrics; do not add a query service or second registry.
- Keep bounded authoritative event-set declarations in the Junction adapter and canonical correction/retraction behavior in core.

## Tasks

1. Prove production legacy scalar/date shapes and map raw-receipt/dedupe/schema/query affected surfaces.
2. Collapse menstrual preparation/emission and fix source-instance plus newest-first admission.
3. Add dedicated activity metrics to importer, health catalog, and query activity summaries.
4. Add importer/core/query regressions, including privacy, reorder, cap, latest/trend, and sleep/activity separation.
5. Update durable docs/changelog and PR disclosure/stats; verify, commit, push, and report the exact head without launching ReviewGPT.

## Verification

- Focused importers/core/health-metrics/query/changelog tests and relevant typechecks.
- Scenario integrity, dependency policy, diff/privacy/Frog review.

Completed proof:

- Importers: 15 files / 393 tests passed; package typecheck passed.
- Query: focused normalized-surface and source-health suites, 21 tests passed; package typecheck passed.
- Health metrics: catalog suite, 53 tests passed; package typecheck passed.
- Vault integration: importer-to-core-to-query activity summary test passed; package typecheck passed.
- Changelog: focused archive/fragment/page suites, 52 tests passed; hosted-web typecheck passed.
- Scenario integrity (204 scenarios), dependency policy, diff check, and Frog review passed.
Completed: 2026-08-11
