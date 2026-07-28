# Restore phase-one dormant snapshot rearming

Status: completed
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Rearm dormant persisted snapshots in phase one so every receipt-backed
  message carrier is scrubbed on time while recent unstamped legacy transcript
  pairs remain intact.

## Success criteria

- The additive mailbox migration makes every persisted snapshot due once and
  clears its prior signal-attempt timestamp.
- Snapshotless workspaces remain untouched.
- A combined retention-only restore/checkpoint regression proves one due wake
  removes expired capture/search/parser/input/stamped-transcript content while
  preserving the recent unstamped legacy user/assistant pair in order.
- Durable rollout guidance distinguishes the phase-one receipt-backed scrub
  from the later phase-two unstamped-transcript scrub.
- Focused tests, typechecks, canonical verification, ReviewGPT, and PR CI pass.

## Scope

- In scope:
  - The existing content-retention migration and its direct tests.
  - The hosted runtime production-path retention regression.
  - Current architecture, security, reliability, protocol, and deploy docs.
  - PR #936 round-five correction evidence.
- Out of scope:
  - A new wake, receipt, scheduler, queue, or reconciliation owner.
  - Phase-one retirement of unstamped legacy transcript entries.

## Tasks

1. Reproduce the dormant null/future-wake exposure path from migration through
   due-work selection and runtime restore.
2. Restore the one-time phase-one snapshot rearm.
3. Combine legacy-pair preservation and receipt-backed carrier retirement in
   one runtime restore/checkpoint/second-restore regression.
4. Align durable rollout guidance and the PR body.
5. Run focused and canonical verification, commit/push, and continue the
   ReviewGPT correction loop.

## Decisions

- Accept ReviewGPT round five's finding: preserving unstamped transcripts made
  the broad removal of phase-one rearming unnecessary and left unrelated
  receipt-backed carriers beyond their deadline in dormant snapshots.
- Reuse the existing migration, cron claim, retention-only signal, runtime
  maintenance, and checkpoint path.
- Accept the product-experience timing concern as a rollout-contract gap, not a
  reason to add a speculative dispatcher. A private aggregate capacity
  preflight confirmed the current fleet fits the existing owner; durable
  guidance now requires the same preflight before migration, keeps phase one
  incomplete until its due queue reaches zero, and gates phase two on both the
  completed drain and full interval.

## Verification

- `apps/web/test/hosted-retention-cleanup.test.ts` and
  `apps/web/test/hosted-mailbox-schema.test.ts`: six tests passed.
- The isolated real-Postgres additive migration proof passed and confirmed that
  persisted snapshots with null or future wakes become due while snapshotless
  rows remain unchanged.
- The combined Assistant Runtime restore/checkpoint/second-restore regression
  passed, proving one rearmed wake retires capture/search/parser/input/stamped
  transcript content while preserving the unstamped legacy pair.
- Assistant Runtime and Web typechecks passed.
- Canonical `pnpm test:diff ...` passed all guards, 76 Assistant Runtime files
  with 1,874 tests, the complete Web typecheck/lint/smoke/build plus 514 files
  with 6,553 tests, and Cloudflare node/worker verification with 1,900 tests.
- The required product-experience re-review returned `PASS` after the
  capacity-preflight and due-queue drain gates were documented.
- `git diff --check` and the task privacy scan passed.
Completed: 2026-07-26
