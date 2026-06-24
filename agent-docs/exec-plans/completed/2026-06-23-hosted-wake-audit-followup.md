# Hosted wake audit follow-up

## Goal

Resolve the two fresh ReviewGPT audit findings on PR 259's hosted runtime wake
selection before the PR lands.

Success criteria:

- Regression coverage proves an earlier assistant retry cannot erase a later
  device-sync reconciliation wake.
- Regression coverage proves the 30-second pending-input retry is not delayed
  by an unrelated post-checkpoint system-maintenance gate.
- The fix preserves foreground assistant priority without adding a second
  scheduler or new durable runtime state.
- Required local verification, completion audits, ReviewGPT loop, and PR CI pass
  before merge.

## Constraints

- Continue on branch `codex/hosted-foreground-preemption` for PR 259.
- Keep changes narrow and composable; prefer deletion or tighter wake merge
  semantics over new state holders.
- Runtime-owned workspace wake projection remains the only scheduler projection.
- Device-sync durable facts remain owned by the existing device-sync store/web
  handoff path; do not move provider or dirty state into assistant foreground
  work.
- Preserve unrelated active ledger rows and working-tree edits.
- Do not expose secrets, direct personal identifiers, local account names, or
  home-directory paths in committed files or handoff text.

## Approach

1. Reproduce each audit finding in the hosted workspace entrypoint suite.
2. Inspect existing wake projection and device-sync scheduling seams before
   choosing a fix.
3. Implement the smallest ownership-preserving correction.
4. Run focused assistant-runtime tests, diff-aware verification, typecheck, and
   smoke checks.
5. Run required completion audits, resolve accepted findings, commit with
   `scripts/finish-task`, push, run ReviewGPT to zero accepted findings, wait
   for final CI, and merge PR 259.

## State

In progress.

## Notes

- Finding 1: an earlier assistant retry can replace and then clear a later
  `device-sync.reconcile` wake even though the durable device-sync schedule
  remains present.
- Finding 2: an unrelated post-checkpoint system item can incorrectly make the
  pending-input assistant retry checkpoint-gated, delaying the retry to idle
  shutdown.

Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
