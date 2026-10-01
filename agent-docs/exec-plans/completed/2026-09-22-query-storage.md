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
- Implementation is committed in PR #3660. Final ReviewGPT round 1 returned PASS
  on b5009189455aa972a2d15c140ea51291118842cb with no qualifying findings.
  Mountain lane selected GPT-6 Pro; the response model slug, exact preceding user
  turn, response SHA-256 and completion marker were verified. Capture followed
  the accepted send by 673 seconds, above the 180-second gate minimum.
  The full snapshot metadata named sensitive scope, round 1, the same immutable
  first/current head and no remediation delta. The substantive owner-path review
  also reported 3,015 codec roundtrips, transaction rollback, malformed-data and
  sparse-rowid/FTS checks. Its full repository suite was not run; CI owns that gate.
- Review conversation: https://chatgpt.com/c/6ab32150-d8b8-83e9-b77a-ef0a9812b105
- Local ignored evidence: `audit-packages/pr-3660-round-1.md` and its capture/model
  verification sidecars. Response SHA-256:
  `ec72cdc311ccf1fdd1934cba61fb81e8b258c8f408716060157b5a4673a9a72c`.
- Parent final review accepted PASS: no outstanding findings. This closeout changes
  only explanatory plan/index documentation; it does not alter the reviewed
  production source, schema or behavior. Exact final-head CI is tracked by the PR
  required checks and remains mandatory for handoff. No merge or deployment is
  included in this task. Private source archive and production state stay untouched.

## Decisions

SQLite owns compaction's transaction and interruption safety. No custom temporary
file swap, scheduler, canonical migration, or additional durable truth owner.
The original audit plan is completed historical evidence and remains unchanged.
Status: completed
Updated: 2026-09-22
Completed: 2026-09-22
