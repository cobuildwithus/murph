# Deduplicate query metric payload storage

Status: completed
Created: 2026-09-21
Updated: 2026-09-21

## Goal

Store identical metric metadata once per projection publication while preserving every public metric and the complete restorable SQLite cache.

## Success criteria

- Repeated payloads share an integer reference; filtered, ordered, bounded and unbounded reads reconstruct identical metrics.
- Publication and rollback keep rows and payloads together. Rebuilds remove retired payloads.
- Previous schema generations rebuild; current caches restore without rebuilding.
- Focused tests, typecheck, complexity guard, parent review, exact-head CI and final ReviewGPT pass.

## Scope and constraints

Only the rebuildable query projection and its tests/documentation change. Canonical records, raw evidence, wearable summaries, public outputs and restore inclusion remain unchanged. No private fixture data or measurements enter repository artifacts.

## Design

Use a query-owned payload table with integer primary keys and an insertion-local map keyed by exact serialized payload. Do not persist a duplicate text index or hash. Production inserts the complete metric generation once inside its existing transaction; supplementary calls may add independent payload rows and cannot overwrite prior references. Join payloads in the existing bounded query, retaining filter indexes and one statement per filter. Schema generation 32 uses the existing reset owner.

## Risks and mitigations

- Dangling references: SQLite foreign keys, required-table freshness checks and transactional publication.
- Accumulated retired metadata: clear the payload table after metric rows in each full replacement.
- Changed values or provenance: reuse the existing codec and assert full public results, including raw/canonical differences.
- Query overhead: retain indexed filtering, measure joined read latency and inspect query plans.

## Tasks

1. Add normalized payload storage, replacement lifecycle and schema reset.
2. Update internal SQL fixtures; prove deduplication, parity, rollback, replacement, upgrade and restore.
3. Review privacy and architecture, run focused verification, commit and update the owned PR.
4. Run final ReviewGPT concurrently with exact-head CI and report measured outcome.

## Verification

- Query storage, complete query API and browser lab tests: 126 passed.
- Date-index, canonical publication, provider scope, wearable source health and concurrency: 53 passed, one existing skip.
- Assistant vault-share sleep coverage: 11 passed; stale-cache fixture follows the new payload reference.
- Query and assistant-runtime typechecks passed; complexity guard passed with no changed hotspots above 20.
- Synthetic proof: 1,200 metric rows share three exact payloads while retaining raw/canonical differences, filtered order/limits and copied SQLite reads. Injected publication failure preserves both tables, and a subsequent full rebuild clears retired payloads. Inline-payload v29/v30/v31 fixtures reset to the current layout.
- Parent review: existing codec and canonical authority preserved; foreign keys and publication ordering are coupled; no new dependencies, network calls, per-row read statements or snapshot exclusions. Internal implementation only, so no public changelog entry.
- Layout experiments use private inputs only in memory; full metric row equality and integrity checks passed. Alternating bounded and complete metric reads showed no measured in-memory slowdown; this is not production disk latency proof.
- Final PR update, exact-head CI and required ReviewGPT remain completion gates outside this implementation commit.
Completed: 2026-09-21
