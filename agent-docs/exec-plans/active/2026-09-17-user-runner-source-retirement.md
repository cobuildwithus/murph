# Remove retired UserRunner source and operational surfaces

Status: active
Created: 2026-09-17
Updated: 2026-09-17

## Outcome and boundaries

Remove the obsolete UserRunner coordinator, finite migration tooling, phantom
bindings and stale operating instructions after verified production retirement.
Preserve Postgres authority, native container execution, reusable runtime helpers,
canonical migration receipts, database migration history and Cloudflare class
migration history. Do not change reply behavior or pursue latency optimization.

The completed rolling migration record is historical evidence, not an active
operator procedure. The remaining rehearsal namespace requires usage inspection
and an exact destructive action decision before any infrastructure removal.

## Tasks

1. [done] Trace surviving imports and test owners; isolate dead coordinator
   and migration surfaces from helpers used by Postgres and native containers.
2. [done] Delete obsolete public source/tests and private migration workflow;
   correct contracts and current documentation without editing completed plans.
3. [done] Run focused behavior tests, affected typechecks, Worker bundle proof,
   documentation checks and parent privacy/complexity review.
4. [in progress] Complete scoped commits, exact-head CI and required final review;
   merge authorized changes and retire completed checkouts.

## Verification

Preserve composed Postgres ownership, authorization, upload cleanup and native
container lifecycle tests. Delete tests only for removed execution paths; retain
or update mixed suites that also prove live behavior. Prove removed operator
routes remain unavailable. A source cleanup does not itself prove a latency gain.

## Product UX

Internal removal only. Existing member execution and replies are unchanged.

## Candidate evidence

- Removed the coordinator, SQLite state/export/freeze paths, migration operator,
  migration checkpoint RPCs, phantom production contracts, and one-time atomic
  deployment branch. Retained ordered Wrangler migrations and canonical receipts.
- Preserved live Postgres, native lifecycle, authorization, and R2 cleanup proof.
  Ported preparation tests to the current implementation and a binding fixture.
- Focused Node run: 924 assertions passed; removed the leftover empty suite and
  confirmed its five retained error-redaction tests pass. The real Workers
  harness passed 24 tests across five suites. Affected Cloudflare typecheck passed.
- Complexity guard passed: deployment maximum fell from 15 to 11; existing
  container dispatch/readiness and preparation hotspots were not expanded.
  Documentation drift and added-line privacy scans passed.
- Private workflow removal is coordinated with this public CLI removal. Its
  full verification and both required reviews remain completion gates.
- Rehearsal storage is outside this source change; a read-only census found
  retained data. No infrastructure deletion or production deployment is included.
- Changelog: not applicable; internal removal of already-retired behavior.

## Review and build follow-up

Public final ReviewGPT round 1 passed on the first candidate. CI declaration
emit found a non-exported R2 cleanup result type; exporting that existing shape
fixes the build without changing runtime behavior. A Web source-contract test
still opened the deleted coordinator; its obsolete assertion is removed while
its live Web log-owner assertions remain. Cloudflare production build, Web
focused tests (12), Web typecheck, and another 40 focused Postgres/resource tests
passed. The private full verification also passed, including built-worker proof.
The corrected public candidate receives another exact-head review with CI.
