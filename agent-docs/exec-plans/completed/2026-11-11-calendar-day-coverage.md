# Complete sparse source-local calendar refresh coverage

Status: completed
Created: 2026-11-11
Updated: 2026-11-11

## Goal and proof

A strict sparse refresh must collect the complete source-local day before replacing its daily total. Natural finite diagnostics distinguish a source-offset crossing from an invalid UTC date. A composed synthetic provider/importer test reproduces the rejection for both positive and negative offsets.

## Scope and ownership

Change only strict sparse calendar refresh collection and importer-owned day selection. Preserve source lifecycle checks, canonical write ownership, value validation, existing job identity, foreground priority, and metadata-only diagnostics. No operational repair or new persisted state. Existing PR4862 changes an unrelated provider import; PR4794 changes reconcile-proof renewal, not this collection path. Telemetry PR4857 is merged and deployed and does not fix acceptance.

## Plan

1. Prove both offset crossings fail with the current composed owner.
2. Fetch the bounded adjacent UTC days before selecting the canonical source day using the existing importer resolver. Keep malformed rows fail-closed; failed or yielded collection cannot replace any day.
3. Prove nonempty, empty, unavailable, malformed and foreground-yield journeys; inspect the complete patch and affected typechecks.
4. Commit, pass required exact-head CI, merge and deploy via the protected release owner. Observe natural resource-specific recovery under the original run.

## Product UX

Effort: Patch. Source-local daily totals recover without changing their dates or fabricating partial totals. Interrupted refreshes retain prior data and retry. No new member action or UI. Parent review: Ready. Complete collection waits until its bounded UTC envelope has closed; this preserves all accepted offsets, including the normalizer's 24-hour boundary.

## Verification

- Before change: both composed offset tests fail with JunctionSparseCalendarRepairNormalizationError.
- Passed: 12 new composed calendar cases, 111 existing provider history/diagnostic cases, 274 importer cases, importer and device-sync typechecks, four rendered changelog cases, and complexity diff with zero added debt.
- Parent review: retained source lifecycle, canonical identity, empty-day authority, offset bounds, malformed-row rejection, bounded pagination, foreground yield, and existing retry owner. No new persisted state or secret access.
- PR4867 is the implementation candidate. Required exact-head CI, merge, protected deployment and four-hour natural-traffic observation continue in the original automation memory; they are not claimed complete by this implementation record.
- ReviewGPT skipped by explicit user instruction; parent review retained.
Completed: 2026-11-11
