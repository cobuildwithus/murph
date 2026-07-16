# PR 626 Round 4 Recovery Prefix

## Goal

Prevent a partially persisted handled batch from being regrouped with a later
post-freeze successor and stalling the reply lane after restart.

## Constraints

- Keep accepted-turn evidence as the existing recovery source of truth.
- Repair and advance only a contiguous cursor prefix proven by valid modern
  input-keyed evidence or uniquely mapped legacy capture-keyed evidence.
- Leave every uncovered successor pending for a later turn.
- Keep holes, overlaps, conflicting fingerprints, foreign members, and
  non-prefix evidence fail-closed.
- Migrate a valid legacy prefix to the same modern input-keyed evidence, and
  reject mixed modern/legacy outcomes that disagree.
- Do not broaden legacy capture-keyed identity or add persisted state, a queue,
  a state machine, a reconciliation service, or a new recovery owner.
- Preserve unrelated working-tree and coordination-ledger changes.

## Plan

1. Add a production-scanner regression that reproduces handled `[A, B]`, a
   surviving partial evidence file, post-freeze successor `C`, and restart.
2. Normalize modern and legacy recovery to the exact evidence-covered cursor
   prefix and return progress only through that prefix.
3. Prove `C` and a later unrelated input each process exactly once without a
   duplicate provider request for `[A, B]`.
4. Run focused owner tests, package typecheck/coverage, completion audits,
   exact-head CI, and ReviewGPT round 5.

## Verification

- Focused assistant automation runtime regression before and after the fix.
- Full assistant-engine automation runtime suite.
- Assistant-engine package typecheck and coverage.
- `git diff --check` and diff-aware verification for the touched owner.
- Required completion audit, exact-head CI, and ReviewGPT round 5.

## State

Round 4 found a confirmed original-PR High liveness failure. The requirement-
level retrospective is recorded in the PR body. Modern and legacy prefix
recovery now share one fail-closed identity rule; verification is in progress.

Status: completed
Updated: 2026-07-15
Completed: 2026-07-15
