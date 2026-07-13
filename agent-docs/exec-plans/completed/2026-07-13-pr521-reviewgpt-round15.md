# PR 521 ReviewGPT Round 15

## Goal

Close the concrete Round 15 provenance finding by requiring stored event
outputs to match the exact prepared-event owner, not merely the same evidence
roles, without adding durable state or another reconciliation layer.

## Accepted finding

A protected historical delivery can currently retain an unrelated event output
when that event has the same evidence-role set. A replay can then expose the
delivery as provenance for the unrelated event even though the prepared event
never owned that output id.

## Complexity disposition

Reuse the existing transient prepared-event ownership facts and injective
output claim map. Delete the role-only authorization path. Do not add persisted
state, compatibility machinery, or a second owner index.

## Invariants

- A stored event output authorizes an exact no-op only when the output id is
  claimed by that exact prepared event and its evidence roles still match.
- Legitimate historical owners remain valid across provider revisions and
  deduplication moves.
- Output ownership remains injective when protected events share evidence
  roles.
- A rejected replay leaves event, ingest, and audit storage byte-stable.

## Plan

1. Add a focused regression that reproduces unrelated same-role authorization.
2. Reuse the transient owner resolver for stored-output validation and remove
   the role-only inference.
3. Run focused tests, owner coverage/typecheck, specialist audits, and parent
   final review.
4. Finish the scoped plan commit, push the exact head, run ReviewGPT and CI in
   parallel, update from the base branch if needed, then merge once green.

## Verification

- Pre-fix focused regression failed with `Missing expected rejection`, proving
  an unrelated same-role output authorized an exact no-op.
- The corrected focused regression passes for both an unrelated physical owner
  and a schema-valid wrong evidence role while proving event, ingest, and audit
  files remain byte-stable.
- The focused eight-test ownership/preservation matrix passed.
- `pnpm --filter @murphai/core exec vitest run test/device-import.test.ts test/integration-ingests.test.ts`
  passed 158 tests.
- `pnpm --filter @murphai/core typecheck` passed.
- Final `pnpm --filter @murphai/core test:coverage` passed 41 files and 654
  tests at 90.47% statements, 82.04% branches, 95.81% functions, and 90.54%
  lines.
- `pnpm test:diff packages/core/src/mutations.ts packages/core/test/device-import.test.ts`
  passed repository guards and reached reverse-dependent typechecks, then
  stopped on the unchanged `packages/hosted-execution/test/hosted-execution.test.ts:548`
  missing `@murphai/hosted-execution/clinical-records` module already recorded
  in prior PR rounds. The current diff does not touch that package or import.
- Required security/privacy review found no evidence-backed medium-or-higher
  finding. Required coverage-write retained the schema-valid wrong-role proof;
  it rejected a proposed all-protected-owner completeness assertion because
  partial output sets are legitimate raw-only history.
- Parent final review and `git diff --check` passed. No persisted state,
  dependency, API, or deploy-boundary change was added.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
