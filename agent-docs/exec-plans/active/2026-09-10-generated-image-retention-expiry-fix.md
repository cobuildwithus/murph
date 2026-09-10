# Complete generated-image cleanup after hosted expiry

Status: active
Created: 2026-09-10
Updated: 2026-09-10

## Goal

- Complete due generated-image capture retirement after the hosted media owner
  expires its bytes, preserving canonical ownership and guarded writes.

## Success criteria

- Reproduce the composed warm/cold expiry failure before the fix.
- Retire valid, materializer-reported missing images without fetching expired
  bytes; preserve rejection of changed bytes and invalid metadata.
- Pass focused tests, relevant typechecks, parent review, final ReviewGPT and
  required exact-head CI; open a PR without merging or deploying it.

## Scope

- In scope: core retention's existing materializer result, canonical receipt
  semantics, focused regressions, and the owning reliability contract.
- Out of scope: retention policy changes, new schedulers, production repair,
  delivery replay, and unrelated work in other checkouts.

## Constraints

- Reuse the existing missing-path report and canonical create/replace receipts.
  Keep absent bytes distinct from a mismatched existing file. Validate the
  manifest against the immutable event before creating a tombstone.
- Product UX patch: Outcome — complete the existing 14-day retirement promise.
  Reaches — warm and restored hosted workspaces with expired generated images.
  Proof — canonical deleted readback, idempotence, replay and negative cases.

## Risks and mitigations

1. Missing bytes alone could hide corruption. Require the existing materializer
   to report the exact path missing and validate original event/manifest identity.
2. A file appearing during commit could be overwritten. Use create-only raw
   writes for an absent preimage and retain guarded replacement for present bytes.
3. Historical warnings can also represent changed bytes. Do not claim every
   production warning is the reproduced expiry case or bypass hash checks.

## Tasks

1. Trace and reproduce hosted expiry through the actual materializer.
2. Correct core consumption of its result and prove canonical recovery.
3. Review, document, commit and open the verified PR.

## Decisions

- Hosted media and core both use the original capture's 14-day cutoff. The
  materializer deletes/declines expired bytes and reports their path missing;
  core currently discards that result and fails its original-byte precondition.
- No persisted schema or new runtime owner is required. Existing create-only
  raw receipts reject conflicting bytes and support idempotent replay.

## Verification

- Focused generated-image retention, hosted artifact and receipt replay tests;
  core/runtime typechecks; privacy, complexity and documentation guards.
- Expected: no recheck wake after valid expiry cleanup, no media resurrection,
  and unchanged fail-closed behavior for unreported loss or metadata mismatch.

## Candidate evidence

- At base `62609d5a09bf169eacd6e8be108e26fd41275035`, the missing-image core
  regression and both real-materializer warm/cold-shaped regressions failed:
  one blocked capture, zero retirement, and another daily wake.
- After correction, all 21 core retention tests and all 63 hosted artifact/idle
  maintenance tests pass. Both new composed cases make zero media GET calls.
- Full canonical receipt replay creates the absent tombstone, remains
  idempotent, and rejects conflicting bytes. Negative cases retain live metadata
  for unreported absence, changed bytes, mismatched manifest hash and wrong owner.
- Both core and assistant-runtime typechecks pass; all 10 changelog rendering
  tests, privacy and docs-drift checks pass. Complexity remains debt 3 / max 23;
  candidate materialization belongs in the existing preparation owner.
- Parent reviewed the full diff: one production owner changed, no provider
  input, foreground path, scheduler, persisted format or retry-policy additions.
- Final ReviewGPT, exact-head CI and plan closure remain pending for the PR.
