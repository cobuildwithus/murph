# PR 614 ReviewGPT Round 4

## Goal

Validate and close the exact-head durable-retention finding without losing the
preexisting-middle stale/new convergence fixed in Round 3.

## Evidence

- ReviewGPT completed a valid Pro-model review of `7c53ef9b32` with the guarded
  ZIP and `REVIEW_COMPLETE` marker.
- The review identified two production-boundary hypotheses: a missing accepted
  older revision may be mistaken for a currently skippable member, and an
  intact deterministic event without `externalRef` may append a duplicate
  association ingest on exact retry.
- Both paths require focused failing tests before implementation.

## Plan

1. Add a cross-month combined WHOOP v1/v3 partial-loss matrix for distinct,
   shared, and roleless evidence, and strengthen the exact no-`externalRef`
   retry with whole-vault byte proof.
2. Reject or narrow any finding that does not reproduce from reachable state.
3. Refine the transient reconciliation disposition so current skip behavior is
   not confused with durable representation of an accepted member.
4. Preserve the preexisting-middle v2 plus stale-v1/new-v3 exact replay matrix
   and surviving-anchor repair rules.
5. Run focused and full owner verification, required completion audits, close
   the plan, push, and start the next exact-head ReviewGPT round with CI.

## Invariants

- Exact no-op requires durable proof for every accepted prepared member.
- A missing accepted revision must repair through a unique surviving anchor or
  fail closed; current provider ordering alone is not durable proof.
- Deterministic no-`externalRef` exact retry is byte-stable and appends no
  association ingest or audit.
- The fix adds no persisted witness, index, service, queue, or compatibility
  layer.

## Outcome

- Reproduced and accepted both Round 4 paths: incomplete cross-month WHOOP
  history could be mistaken for durable retention, and exact deterministic
  events without `externalRef` could append duplicate association evidence.
- Exact no-op now requires a complete currently indexed revision spine before
  a provider-order skip counts as retained. Distinct-role loss repairs through
  the existing surviving anchor; shared or roleless ambiguity fails closed.
- Deterministic events without `externalRef` now recognize identical live
  device content as an exact retry without appending ingest or audit records.
- The correction is transient reconciliation logic only. It adds no persisted
  state, dependency, service, queue, or compatibility layer.

## Verification

- `pnpm --dir packages/core typecheck` passed.
- `pnpm test:scenario-integrity` passed all 207 scenarios across 11 inputs and
  28 golden directories.
- `pnpm --dir packages/core exec vitest run test/device-import.test.ts` passed
  all 152 tests.
- `pnpm --dir packages/core test:coverage` passed 683 tests and reported 90.2%
  statements, 81.79% branches, 95.49% functions, and 90.25% lines. The command
  exited nonzero only because the known unrelated
  `preferences.test.ts` causal-token test timed out at 60 seconds.
- Coverage-write and security/privacy completion audits reported zero
  medium-or-higher findings and made no edits.
- `git diff --check` and the scoped privacy/secret scan passed.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
