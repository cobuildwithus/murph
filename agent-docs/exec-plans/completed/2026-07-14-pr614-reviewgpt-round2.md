# PR 614 ReviewGPT Round 2

## Goal

Close the exact-head stored-role inversion finding without adding persisted
member-decision state or weakening accepted retry and repair behavior.

## Evidence

- ReviewGPT completed a valid Pro-model review of `95e8564321` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- Stored output roles are a set-union for a canonical owner, so they cannot by
  themselves prove which shared-role or roleless prepared members were accepted.
- The production reconciliation loop already owns the decision that an incoming
  member is an exact duplicate or a strictly older provider revision.

## Plan

1. Add failing production-boundary regressions for fresh newest-then-stale
   shared/empty-role exact replay and for a missing accepted roleless revision
   behind a surviving role-bearing member.
2. Reuse the existing reconciliation authority to prove skipped owner members
   during intact exact replay, while rejecting newer, incomparable, or otherwise
   unresolved members.
3. Keep role inversion repair-only and remove any unconditional inversion from
   sample/evidence-only persistence.
4. Run focused and full owner verification, required completion audits, close
   the plan, push, and start the next exact-head ReviewGPT round with CI.

## Invariants

- A byte-identical accepted delivery must remain an exact no-op even when its
  prepared members share one role or have no role.
- A missing accepted newer member must never be hidden by a surviving stale
  role-bearing revision.
- Repair must fail closed when durable state cannot prove member acceptance and
  placement.
- The correction must stay within the existing event-reconciliation owner and
  introduce no new persisted witness, index, queue, or compatibility layer.

## Outcome

- Reproduced ReviewGPT's shared-role and roleless fresh newest-then-stale retry
  failures at the production boundary before changing the implementation.
- Reused batch-local baseline reconciliation to prove skipped members during an
  intact exact replay, and limited stored-role inversion to event repair that
  actually needs a member-to-output mapping.
- Confirmed the separate missing accepted roleless-member path already failed
  closed, then retained it as a regression test.
- Added sample-only repair coverage for both shared-role and roleless deliveries
  without adding persisted decision state or reconstructing event spines.

## Verification

- `pnpm --dir packages/core exec vitest run test/device-import.test.ts`: 141
  passed.
- `pnpm --dir packages/core typecheck`: passed.
- `pnpm test:scenario-integrity`: passed for 207 scenarios, 11 sample inputs,
  and 28 golden directories.
- Full core coverage: 672 passed and one unrelated pre-existing
  `preferences.test.ts` 60-second timeout; 90.22% statements, 81.88% branches,
  95.56% functions, and 90.28% lines.
- Required coverage-write audit: zero findings.
- Required security/privacy audit: zero medium-or-higher findings.
- `git diff --check` and the scoped privacy/console scan: passed.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
