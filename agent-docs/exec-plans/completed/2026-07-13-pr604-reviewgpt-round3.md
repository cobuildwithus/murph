# PR 604 ReviewGPT Round 3

## Goal

Close the two evidence-backed Round 19 replay gaps without adding a new
persisted ingest schema, migration, or parallel reconciliation owner.

## Evidence

- ReviewGPT completed a valid exact-head review at `f7da57366ae` with the
  guarded ZIP, exact PR context, active requested-model turn, and
  `REVIEW_COMPLETE`.
- Candidate 1: replaying a later delivery after complete loss of its canonical
  event spine can reuse the stored canonical ID but silently restart that
  established spine at revision 1.
- Candidate 2: a batch ordered as stale v1 followed by new v3 against an
  existing v2 spine can persist only v3's role, then reject its own exact
  replay because the synthetic empty-vault baseline treats both rows as
  retained.
- Candidate 3 claimed the existing repeated-content regression should fail.
  The exact test passes on the reviewed head, so that claim is rejected as a
  production or merge-gate failure. Its narrower coverage intent will be
  reassessed only against the reproduced repair paths.

## Plan

1. Add production-shaped failing regressions for complete-spine loss after an
   established later revision and stale-then-new replay against an existing
   provider spine.
2. Fail closed before implicit revision-1 repair when existing durable facts
   cannot uniquely prove the missing historical revision.
3. Make exact stored-role validation consume the stored delivery's accepted
   role set without promoting stale members from synthetic/current history;
   preserve fail-closed behavior when member mapping is ambiguous.
4. Preserve user-edit, tombstone, alias, occupied-output, swapped-output, and
   unrelated-owner protections; run focused and full owner verification.
5. Run fresh coverage and security/privacy completion audits, close the plan,
   push the exact head, and start the next ReviewGPT round with CI in parallel.

## Completion audit findings

The required security/privacy pass found three medium-severity integrity risks,
all accepted:

- shared or empty evidence roles did not identify one unique prepared member;
- matching evidence bytes could not prove a missing multi-delivery revision
  history; and
- full-spine repair scanned the complete ingest history once per missing event
  while holding the canonical write lock.

The correction fails closed on ambiguous role membership and any completely
missing event with more than one historical delivery, and uses one grouped
multi-event ingest-history scan for the whole repair batch.

## Verification

- Focused device-ingest owner/repair matrices pass, including distinct
  stale-then-new replay, shared-role and empty-role ambiguity, single-row
  repair, surviving-anchor repair, multi-delivery full-spine rejection, and
  repeated-repair rejection.
- `pnpm --dir packages/core typecheck` passes.
- `pnpm test:scenario-integrity` passes for 207 scenarios, 11 sample inputs,
  and 28 golden-output directories.
- `pnpm test:diff ...` passed dependency policy, workspace boundaries, hosted
  runtime/crypto/privacy guards, and all 18 affected typechecks. Its concurrent
  test phase hit timeouts in untouched assistant surfaces.
- Full core V8 coverage reached 90.23% statements and 81.86% branches with 665
  passing tests. It exposed two repair compatibility regressions that were
  fixed and rerun successfully; the remaining unrelated preferences test
  exceeds both its ordinary 60-second timeout and an isolated 120-second
  diagnostic timeout on this machine.
- Final security/privacy and coverage-write reruns report zero findings.

## Invariants

- A missing established event spine must never restart at revision 1 unless
  durable evidence uniquely proves that placement.
- The append-only stored integration output remains the accepted role decision
  for exact replay; later event state cannot invent roles for that delivery.
- Existing v1 ingest records remain immutable and fail closed when their repair
  proof is insufficient.
- No new persisted schema, migration, index, queue, lifecycle subsystem, or
  generic reconciliation trace is introduced without proof that the existing
  owner boundary cannot preserve the invariant.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
