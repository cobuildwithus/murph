# Resolve message-retention ReviewGPT round 3

Status: completed
Created: 2026-07-26
Updated: 2026-07-25

## Goal

- Close the three validated round-3 retention failures without adding a new
  scheduler, lifecycle owner, queue, or state machine.

## Validated findings

1. The retention cron's default runtime signal passes through the active-access
   gate, so inactive migration-rearmed snapshots cannot reach the existing
   retention-only blocked-workflow path.
2. Assistant-input retirement treats pending-index absence as terminal and
   treats `sending` as answered even though stale sending intents remain
   selectable for reconciliation or redispatch.
3. Pre-change transcript entries without `contentReceivedAt` still use
   projection-time `createdAt`, so migration-rearmed snapshots can exceed the
   receipt-anchored deadline.

## Constraints

- Preserve the active-access gate for product and AI-producing wake paths.
- Reuse the lower Temporal `signalWithStart` owner with
  `ensureWorkspace: false`.
- Terminalize every linked reply intent before retiring its source content;
  do not infer terminality from snapshot-index membership.
- Reuse existing transcript refs, accepted-input evidence, and input receipt
  timestamps. Fail closed only when a legacy inbound entry has no trustworthy
  receipt association.
- Keep the latest `main` base-only update outside the immutable round-3 review
  delta; merge it normally after remediation is verified.

## Tasks

1. Add a retention-only runtime-recheck wrapper and route the cron default
   through it, with inactive-member/default-composition proof.
2. Delete the unresolved-index terminality shortcut, terminalize queued and
   sending linked intents through the outbox owner, and prove no later provider
   selection after acknowledgement compaction.
3. Stamp every new user transcript entry with a retention basis, recover
   receipt time for legacy entries through existing journal/input evidence,
   and conservatively retire unmatched legacy message content.
4. Run focused Web, Assistant Engine, and Assistant Runtime tests plus
   typechecks and the canonical acceptance lane.
5. Complete parent review, close this plan, push, run ReviewGPT round 4, rerun
   CI, then merge the latest base-only movement and prove final CI/merge state.

## Verification

- Focused Web retention/signaling tests: 34 passed.
- Focused Assistant Engine persistence/retention tests: 30 passed.
- Focused Assistant Runtime pending-input retention tests: 34 passed.
- Hosted Temporal inactive-retention workflow tests: 20 passed.
- Web, Assistant Engine, Assistant Runtime, and Operator Config typechecks:
  passed.
- `pnpm test:diff`:
  - all guards and affected typechecks passed;
  - Assistant Engine: 174 files passed, 1 skipped; 2,676 tests passed,
    5 skipped;
  - Assistant Runtime: 76 files passed; 1,874 tests passed, 2 skipped;
  - stopped only on the unchanged CLI review-preset audit mismatch fixed on
    current `origin/main`.
- `pnpm verify:acceptance`:
  - all 28 workspace typechecks, guards, artifact hygiene, Web lint/smoke/tests,
    Assistant Engine coverage, Assistant Runtime coverage, Cloudflare tests,
    and the remaining completed package coverage lanes passed;
  - stopped only on the same unchanged CLI review-preset audit mismatch fixed
    on current `origin/main`.
- `git diff --check` and direct-identifier diff scan: passed.
Completed: 2026-07-25
