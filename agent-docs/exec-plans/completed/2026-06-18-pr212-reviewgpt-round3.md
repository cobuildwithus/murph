# PR 212 ReviewGPT Round 3 Fixes

## Goal

Fix accepted ReviewGPT round 3 findings for PR 212.

Success means non-idempotent Linq voice memo delivery cannot be retried after a
post-send crash or lease loss, voice memo sends reuse the same concrete Linq
target recovery path as text sends, focused tests prove both failure modes, and
the PR branch is pushed for the next ReviewGPT round.

## Constraints

- Keep the existing outbox/prepared-dispatch lifecycle as the owner of
  non-idempotent delivery safety.
- Reuse the existing Linq target materialization/recovery primitives instead of
  adding a new delivery abstraction.
- Preserve the single Linq-native voice memo path.

## Plan

1. Verify both round 3 findings against current hosted runtime and Linq delivery
   paths.
2. Patch the smallest owner seams for prepared non-idempotent voice memo state
   and concrete Linq target reuse.
3. Add focused regression tests.
4. Run scoped verification, commit, push, and rerun ReviewGPT.

## State

Patched and locally reviewed. Verification passed:
focused assistant-engine/runtime tests, `pnpm typecheck`, explicit
`scripts/workspace-verify.sh test:diff` for the changed code/test paths,
`git diff --check`, and privacy scan.

## Notes

- Round 3 findings: duplicate non-idempotent voice memo sends after crash/lease
  loss; voice memo send discards text-send Linq target recovery.
- Local review also found stale-thread recovery could ignore the selected Linq
  sender; patched `maybeRecoverMissingLinqDirectThread` to preserve sender
  continuity when the route has one.
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
