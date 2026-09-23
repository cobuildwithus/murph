# Compact query cache and review vault storage PR

## Outcome

Combine closed-month audit compression with exact wearable field-name sharing
and SQLite compaction in one reviewed PR. Preserve canonical evidence, public
summary results, search, and complete query-cache restore. No production mutation.

## Implementation

- Share ordered JSON object-key shapes in a derived SQLite table, with tagged
  arrays and objects, transactionally replaced with wearable rows.
- Read shapes and summaries from one read transaction; preserve unusual keys.
- Bump cache version to 34. Pin search document rowids with INTEGER PRIMARY KEY,
  then VACUUM after successful full publication under the existing writer lock.
- Keep compaction out of fresh reads and wearable-only publication.

## Verification and completion

- Passed: 158 focused query tests (one additional existing test is skipped),
  covering byte-exact summary roundtrip, provider filters, replacement/rollback,
  concurrent publication, copied-cache restore, old-cache reset, compression and
  sparse FTS rowid preservation. Query typecheck and complexity guard passed.
- Prior audit implementation proof remains valid: 83 core, 20 query and 51 hosted
  runtime tests, plus core/query/runtime typechecks and declared dependency builds.
- Parent review: dictionary table is derived data, coupled to rows by the existing
  publication transaction; readers pin a snapshot. No canonical or provider-facing
  fields are deleted. Search rowids are explicit before enabling compaction.
  Existing complexity hotspots remain unchanged except idle maintenance decreases.
- Product UX: internal physical representation only; public APIs and evidence stay
  intact. Changelog not applicable because member behavior is unchanged.
- Pending: scoped candidate commit, PR, exact-head CI and final ReviewGPT.

## Decisions

SQLite owns compaction's transaction and interruption safety. No custom temporary
file swap, scheduler, canonical migration, or additional durable truth owner.
The original audit plan is completed historical evidence and remains unchanged.
