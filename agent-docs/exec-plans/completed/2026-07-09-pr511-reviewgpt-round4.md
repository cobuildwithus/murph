# PR 511 ReviewGPT Round 4

Status: completed
Created: 2026-07-09
Updated: 2026-07-10

## Goal

Close ReviewGPT round-four findings without adding another authority mechanism:
preserve committed conversation work through access changes, make the current
Linq roster the single participant-sponsored authority when the route owner is
inactive, and state the truthful runner rollback floor.

## Constraints

- Participant events remain context-only: ledger plus one coalescing addition
  bit, with no participant identity retention, roster mutation, wake, timer,
  queue, or outbound message.
- Keep the active-owner path provider-free.
- Do not call Linq while a Prisma transaction is open.
- Reuse the existing two-pass webhook planning shape for the exceptional
  owner-inactive roster read; add only the per-route observation watermark
  required to order overlapping snapshots, with no lease or scheduler.
- Decide owner-inactive authority from the complete live snapshot itself; keep
  the resolved participant rows as a bounded post-admission access projection,
  not a second current-roster authority.
- Preserve committed conversation processing independently from fresh
  admission, system-only work, and current egress access; do not add a
  duplicate-only recovery branch.
- When a caller needs participant handles, return the routing resolver's exact
  authority snapshot instead of issuing a second provider read.

## Tasks

1. Let accepted conversation rows signal, reconcile, and fetch without a second
   current-access admission check, including imported-but-unconsumed replay;
   keep system-only admission current-access gated.
2. Delete callback-sender projection repair and centralize strict current-roster
   resolution for owner-inactive Linq ingress and egress, ordered by one
   route-owned observation watermark.
3. Correct the runner/web compatibility and rollback-floor contract.
4. Remove the group tool's duplicate roster read and obsolete refresh wrapper.
5. Run focused and full verification, local completion audits, and a fresh
   exact-head ReviewGPT loop to valid zero findings.
6. Commit through `scripts/finish-task`, push PR 511, and verify replacement CI.

## Verification

- Focused hosted web ingress, group-tool, egress, mailbox, roster, migration,
  and participant-event tests: 438 passing, plus the final five-test non-null
  migration check.
- Focused assistant-runtime persisted pending-input test: 59 passing.
- Root `pnpm typecheck` and the repo-required web verification lane: 4,054 web
  tests passing, zero lint errors, dev smoke passing, and the 181-route
  production build passing.
- Coverage, security/privacy/reliability, deletion/simplicity, and task-finish
  re-audits completed with no remaining findings.
- Exact-head ReviewGPT response with `REVIEW_COMPLETE` and no findings remains
  the post-push merge gate.
Completed: 2026-07-10
