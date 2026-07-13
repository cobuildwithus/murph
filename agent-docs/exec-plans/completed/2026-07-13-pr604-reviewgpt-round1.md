# PR 604 ReviewGPT Round 1

## Goal

Make exact replay and missing-output repair consume one transient reconciliation
decision for each prepared device event, including duplicate content, provider
legacy-ref migrations, and retained revisions split across monthly shards.

## Evidence

- ReviewGPT completed a valid exact-head review of PR 604 at `05a561c786c` with
  the requested model, guarded ZIP, exact-turn capture, and `REVIEW_COMPLETE`.
- High finding 1: two same-spine prepared rows with byte-equivalent normalized
  content but distinct evidence roles persist only the first role, while exact
  replay reconstructs both roles and rejects the valid stored delivery.
- High finding 2: a batch ordered as primary ref A followed by primary ref B
  with legacy ref A is one canonical spine under the existing identity resolver,
  but the new primary-ref string key creates two output owners and rejects replay.
- The reviewer also identified a partial-shard case: when retained revisions of
  one spine span months and only the older shard disappears, the current latest
  row can hide the missing historical revision from repair.

## Plan

1. Add focused production-shaped regressions for duplicate content with distinct
   roles and batched A-to-B legacy-ref migration; prove both fail before code.
2. Add the cross-month partial-shard regression and determine whether the exact
   stored delivery plus existing reconciliation/index evidence can reconstruct
   the missing historical revision without a new durable owner.
3. Replace independent primary-ref grouping and reconstructed role membership
   with the smallest transient decision derived from the existing event identity
   and reconciliation source of truth.
4. Preserve unrelated-owner, incompatible-alias, swapped-output, role-mismatch,
   stale-provider, user-edit, tombstone, and ambiguity guards.
5. Run focused and owner-scoped verification, required specialist re-audits,
   parent final review, scoped commit, push, and the next exact-head ReviewGPT
   round alongside CI.

## Invariants

- Event identity has one resolver: the existing primary/legacy reservation and
  reconciliation path.
- Append-only stored integration outputs remain the durable record of which
  evidence roles were retained for that delivery.
- Repair restores only revisions proven by the exact delivery and existing
  canonical spine; it never downgrades or overwrites a later revision.
- User edits, tombstones, stale provider versions, unrelated outputs, and
  ambiguous ownership remain protected.
- No persisted index, lifecycle subsystem, queue, or parallel identity key is
  introduced.

## Implementation

- Derive transient prepared-output ownership from a reconciliation pass through
  the existing primary/legacy-ref resolver instead of a second external-ref
  string key.
- Carry only baseline-retained members into exact stored-delivery role checks,
  so byte-equivalent duplicates and rejected stale revisions cannot invent
  durable evidence associations during replay.
- Reuse the stored canonical output plus the baseline retained revision
  decision to reconstruct a missing historical monthly-shard row without
  overwriting a newer row, user edit, or tombstone.
- Keep missing, occupied, swapped, unrelated, malformed, and ambiguous output
  IDs fail-closed; add no persisted index or new identity source.

## Verification

- `pnpm --filter @murphai/core typecheck` passed.
- The final focused device-import and integration-ingest suite passed 162 tests
  before the coverage-only assertions; the fresh coverage audit then passed
  the two expanded tests and an 11-test ownership/protection sweep.
- `pnpm --filter @murphai/core test:coverage` exercised 41 files and 661 tests:
  659 passed, while two unchanged long-running preference/receipt tests reached
  their 60-second timeout. Coverage still completed at 90.58% statements,
  82.21% branches, 95.77% functions, and 90.65% lines. Both timed tests passed
  in isolation, with the preference test using a 180-second timeout.
- `pnpm test:diff packages/core/src/mutations.ts packages/core/test/device-import.test.ts`
  passed dependency policy, workspace boundaries/cycles, runtime/privacy guards,
  and all 18 affected typechecks after building one missing ignored declaration
  artifact. Its concurrent package-test phase stopped on unchanged assistant
  runtime/engine/CLI timing tests; the changed core owner suite remained green
  in the scoped runs above.
- `git diff --check` and the scoped privacy/identifier scan passed.

## Completion Audits

- Fresh `security-privacy-review`: zero evidence-backed medium-or-higher
  findings and no secret or personal-identifier leakage. Ownership conflicts,
  user edits, tombstones, and unrelated outputs remain fail-closed.
- Fresh `coverage-write`: added only the missing proof that duplicate-role and
  partial-month repair preserve the original stored role decision and converge;
  no material coverage gaps remain.
- Parent scope-and-shape review: the correction consumes the existing resolver's
  transient reconciliation result, adds no durable state or package boundary,
  and limits historical reconstruction to a stored delivery's proven canonical
  owner and retained revisions.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
Completed: 2026-07-13
