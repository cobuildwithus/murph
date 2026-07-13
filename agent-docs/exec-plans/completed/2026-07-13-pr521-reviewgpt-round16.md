# PR 521 ReviewGPT Round 16

## Goal

Preserve exact replay and missing-output repair when one device batch contains
ordered revisions of the same provider resource that legitimately reconcile to
one canonical event spine.

## Evidence

- ReviewGPT completed a valid exact-head review at `742e8d5ff13` and reported
  one High finding.
- The existing in-batch supersede test proves that two prepared rows with
  different content IDs may intentionally land as revisions 1 and 2 under one
  canonical event ID.
- The current transient output-owner map assigns that canonical ID to each
  prepared row independently and throws an ambiguity error before replay
  suppression or repair can run.
- A fresh security review of the first grouped-owner implementation found that
  a newest-then-stale WHOOP batch persisted only the newer role but exact replay
  expected roles from both prepared members. The focused regression reproduced
  the failure before the retained-member correction.

## Plan

1. Extend the existing production-shaped in-batch supersede test to replay the
   same batch and prove the current ambiguity failure before changing code.
2. Make stored-output ownership follow the existing canonical event-spine
   grouping and aggregate evidence roles across members of that spine.
3. Cover exact evidence replay and missing-shard repair while retaining the
   unrelated-owner, swapped-output, role-mismatch, and ambiguity guards.
4. Run focused and owner-scoped verification, required coverage follow-up,
   parent final review, scoped commit, push, and the next exact-head ReviewGPT
   round alongside CI.

## Invariants

- Ordered revisions of one proven provider identity may share one canonical
  event output; unrelated external references may not.
- Exact no-op and repair decisions require the full expected role union for
  the members of the canonical spine that were actually retained or would be
  appended by the existing deterministic reconciliation rules.
- Newer provider state, user edits, tombstones, and ambiguous owners remain
  protected.
- No persisted index, lifecycle state, queue, or second identity source is
  added.

## Implementation

- Group prepared event-output owners transiently by event kind plus the
  provider external-ref identity already used by event reconciliation.
- Validate stored exact outputs against roles from retained group members,
  preserving byte-stable no-op behavior without allowing one safe member to
  hide an unsafe member.
- For missing shards, preview the existing in-memory reconciliation decision
  and use only append-eligible members to recover the stored canonical ID.
- Keep unrelated output IDs and distinct provider identities separate, and
  validate non-repaired outputs in mixed deliveries against their original
  roles.

## Verification

- `pnpm --filter @murphai/core typecheck` passed.
- Focused shared-spine, newest-then-stale, and mixed-repair regressions passed.
- `pnpm --filter @murphai/core exec vitest run test/device-import.test.ts test/integration-ingests.test.ts`
  passed 159 tests.
- `pnpm --filter @murphai/core test:coverage` passed 41 files and 658 tests:
  90.55% statements, 82.14% branches, 95.76% functions, and 90.63% lines.
- `pnpm test:diff packages/core/src/mutations.ts packages/core/test/device-import.test.ts`
  passed dependency, boundary, runtime guard, and all 18 affected typecheck
  steps. Its package-test phase stopped on unchanged assistant CLI/runtime tests
  reaching their 60-second timeout under the concurrent matrix; the changed
  core suites remained green in the owner-scoped runs above.
- `git diff --check` passed.

## Completion Audits

- Fresh `security-privacy-review`: zero evidence-backed medium-or-higher
  findings; unrelated IDs, distinct spines, stale revisions, user edits,
  tombstones, malformed rows, and account-mismatched deliveries remain
  fail-closed.
- Fresh `coverage-write`: no coverage gap and no edits; the current regressions
  truthfully cover shared revisions, retained-only roles, exact replay,
  missing-shard repair, repaired replay, and mixed-delivery validation.
- Parent scope-and-shape review: the change extends only the transient owner
  proof around the existing reconciliation source of truth and adds no new
  persisted state, package boundary, or speculative compatibility layer.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
