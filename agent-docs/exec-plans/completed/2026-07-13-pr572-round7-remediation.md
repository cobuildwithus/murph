# PR 572 round 7 remediation

Status: completed
Created: 2026-07-13

## Goal

Resolve the three accepted findings from the substantive ReviewGPT audit of
`b0b8161438c0` and preserve the corrected pending-input wake behavior already
landed on the branch.

## Scope

- Bind the invocation-local preference sequence at the awaited provider
  accepted-input boundary, including live steer, instead of assistant-phase
  selection time.
- Map restored tokenless hosted conversation inputs to sequence zero and make
  zero first-writer-only per field while preserving positive same-turn command
  ordering.
- Keep the normal personality Prisma migration expand-only and move its range
  checks plus existing-row preflight into the post-drain contract lane.

## Constraints

- Keep one mailbox sequence allocator and one canonical preference owner.
- Admit at most one mailbox causal anchor per provider turn and defer later
  anchors; do not add queues, managers, receipts, reservations, or wall-clock
  ordering.
- Preserve current-inbound replies, Settings sparsity, field-local stale no-op,
  fresh siblings, crash/replay terminalization, and the final pending-wake fix.
- Keep the PR draft until the corrected pushed head has green CI and a new
  substantive exact-head ReviewGPT audit.

## Verification

- Prove each finding with focused failing tests before its production fix.
- Run focused provider-boundary, runtime bridge, core preference, migration
  guard/contract, and pending-wake regressions plus owner typechecks.
- Run required diff-aware and scenario-integrity gates before scoped commit and
  push, then rerun exact-head CI and ReviewGPT.

Completed proof:

- Provider planning binds accepted input before execution and releases the
  binding after both successful and terminal provider outcomes; live steer
  updates the same active provider scope.
- A background pass that starts empty binds an input acquired during refresh at
  the provider boundary, not selection time.
- Legacy sequence zero is first-writer-only per field; positive same-turn
  sequencing still applies.
- The normal personality migration is expand-only; the contract migration
  preflights existing rows before installing all three range constraints.
- `pnpm test:diff` passed for the complete affected workspace and app scope.
- `pnpm test:scenario-integrity` passed for 205 scenarios, 11 sample inputs,
  and 28 golden-output directories.
Updated: 2026-07-13
Completed: 2026-07-13
