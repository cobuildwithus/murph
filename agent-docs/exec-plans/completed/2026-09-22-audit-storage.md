# Archive audit history and identify redundant storage

## Outcome and invariants
Compress closed audit months during existing idle maintenance while preserving exact
records, public query/export visibility, document provenance, late writes, hosted
receipt replay and rollback. Keep query SQLite in restore. Inspect further storage
opportunities without editing private archives or production state.

## Evidence and design
Audit shards remain plain after their month closes. Event-ledger storage already
owns verified compressed JSONL publication, bounded decode, exclusive archive
creation, duplicate conflict handling and receipt-backed append/rollback. Extract
that implementation into a directory-bound storage factory for the two current
consumers, retaining the event API and error codes. Route audit enumeration and
reads through the same boundary and extend the existing idle archive budget.
No new scheduler, dependency, ledger, cursor or private fixture.

## Compatibility and failure
Old readers do not understand archived audit months. Reader and writer ship in the
same runtime bundle; after archival, rollback requires an archive-aware bundle.
Malformed or conflicting shards remain untouched and reported; verified equivalent
interrupted copies converge. Current/future months stay plain. Foreground wake
cancels archive work. Late historical audit append and rollback retain content
receipts and existing canonical lock ownership.

## Product UX
Outcome: smaller stored workspace with identical audit history.
Reaches: audit list/export, canonical validation, document promotion provenance,
late writes, interrupted maintenance and checkpoint/restore.
Proof: synthetic owner and composed query/runtime tests, focused typechecks,
complexity guard and parent diff review. Internal physical representation only.

## Work
- [x] Implement shared storage and all audit readers/writers.
- [x] Prove archive/read/late-write/rollback/replay/conflict/cancellation behavior.
- [x] Inspect one or two additional high-value storage reductions.
- [x] Review, record verification and commit the scoped implementation.

## Verification and review
- Core archive, write receipt and document provenance suites: 83 tests passed
  across audit storage, event-ledger storage, compressed ledger storage,
  operations thresholds and raw-manifest idempotency.
- Query audit-family and source-manifest suites: 20 tests passed. Audits retain
  their existing exclusion from the shared query cache; physical audit archival
  does not invalidate that unrelated cache.
- Hosted idle maintenance and protected pending-input suites: 51 tests passed,
  including real event/audit archival and cancellation during either owner.
- Core, query and assistant-runtime typechecks passed. Declared dependency builds
  passed. Complexity guard passed; idle owner maximum decreased from 43 to 38,
  and no complexity debt increased. Diff and privacy inspection passed.
- Parent review verified the extracted archive implementation is mechanically
  equivalent apart from directory binding, names and per-owner error prefixes.
  Audit enumeration, document provenance, validation, late writes, rollback and
  independent hosted replay all use the existing owners. No new persistence
  format is introduced inside the audit records, and no data is discarded.
- Follow-up in-memory experiments identified shared wearable-summary field-name
  storage and SQLite repacking as remaining candidates. Full reconstructed records
  and SQLite integrity passed; compression inside each summary and metric-source
  normalization were rejected because compressed snapshot size regressed.
  These experiments are not production implementations or latency guarantees.
- Changelog: not applicable; internal physical storage change preserves audit
  contents, commands and member behavior. Product proof: Ready for local scope.
- Local implementation endpoint: scoped commit. PR, final ReviewGPT, exact-head
  CI and deployment were not performed; archive-aware release review is required
  before publishing the format change. Original private archive and production
  vault were not mutated.

Status: completed
Updated: 2026-09-22
Completed: 2026-09-22
