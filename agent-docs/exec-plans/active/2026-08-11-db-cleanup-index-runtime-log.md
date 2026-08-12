# Bound foreground database cleanup ownership

Status: active
Created: 2026-08-11
Updated: 2026-08-12

## Goal

- Remove foreground global cleanup and harden the existing retention owner's
  compaction claims against contention.

## Success criteria

- Foreground connected-app, sensitive-action, device-connect, and clinical
  intent creation performs no global expired-row sweep.
- One existing retention owner claims expired work in bounded ordered batches
  with `SKIP LOCKED` and explicit pass budgets.
- Mailbox and Linq compaction claims cannot wait behind overlapping workers.
- Focused tests, Web typecheck/lint, privacy scan, and diff checks pass before a
  scoped local commit.

## Scope

- In scope: hosted retention cleanup; foreground expiry sweeps in connected
  apps, sensitive actions, device connect/OAuth, and clinical connect/OAuth;
  mailbox and Linq compaction claims; focused tests and matching durable docs.
- Out of scope: billing provider ownership, crypto preparation, Linq provider
  calls, broad growth snapshot redesign, device recovery, runtime-log isolation,
  and query/index/pointer work owned by sibling tasks.

## Constraints

- Prefer deletion and reuse the existing retention and isolated-store owners;
  add no queue, scheduler, generic cleanup framework, or speculative index.
- Preserve fail-closed auth, privacy, deletion, and exact-effect replay
  semantics. Transactions remain short, bounded, and database-only.
- Treat ReviewGPT patches as proposals. Inspect open PR overlap and retain one
  mutation owner per file/behavior.

## Risks and mitigations

1. Moving cleanup can leave expired rows indefinitely.
   Mitigation: route every removed sweep to the existing bounded retention pass
   and add direct owner tests.
2. Open PRs touch adjacent device/schema/Linq paths.
   Mitigation: inspect their exact diffs, avoid duplicate ownership, and report
   deferred overlap explicitly.

## Tasks

1. Establish the exact main base, open-PR overlap, current query shapes,
   cardinalities, and retention/runtime-log invariants.
2. Ask ReviewGPT for an attachment-based cleanup patch while sibling tasks own
   query/index and isolated runtime-log work.
3. Inspect and integrate only minimal evidence-backed changes, tests, and
   durable documentation.
4. Run focused unit/PostgreSQL proof, typecheck, lint, privacy and diff checks;
   inspect the final patch.
5. Close the plan with a scoped local commit and hand off URLs, overlap
   decisions, rejected proposals, verification, and remaining blockers.

## Decisions

- Base the branch on `05988dd160797405924a72affdb6366f716c141c`.
- Defer or carefully reconcile device-connect/schema work overlapping PR #1675
  and Linq delivery-store work overlapping PR #1642; do not duplicate their
  implementations.
- Leave query/index/pointer and runtime-log isolation changes to their dedicated
  sibling owners; this branch will not touch those files or behaviors.
- Accept the first exact-head ReviewGPT lifecycle finding: started connected-app
  and Clinical Records intents remain non-redeemable at their public expiry but
  keep the exact completion owner for one bounded 30-minute retention grace.
- Keep retention as the sole owner of completed-row retirement: account-deletion
  safety checks must continue to observe any still-present incomplete owner even
  after its public deadline instead of duplicating the retention predicate.
- Accept the final exact-head ReviewGPT race finding: device and Clinical Records
  OAuth consumers must lock the exact session row before replay classification
  and conditional consume so concurrent `SKIP LOCKED` retention cannot fabricate
  a replay result.

## Progress

- Commits `ddd1cf3a21` and `3aefa120c8` remove foreground global cleanup,
  establish bounded deterministic `SKIP LOCKED` retention, and retain active
  completion owners through the bounded continuation grace.
- Combined focused unit/static coverage passes 141 tests, including exact
  account-deletion predicates and OAuth lock-before-read/update ordering. The
  opt-in real-PostgreSQL concurrency proof passes all four actual-consumer,
  control-artifact, mailbox, and Linq lock scenarios. Hosted Web typecheck and
  scoped lint pass.
- The broader diff fanout previously stalled in an unrelated package test under
  shared host contention and was not retried. Its completed architecture,
  dependency, workspace, and affected typecheck steps remain diagnostic
  evidence rather than a green broad-suite result.
- Final ReviewGPT thread `6a7c2668-d808-83ea-aac1-3bde5f6b093f` was recovered
  through an approved authenticated lane without duplicating the audit. Its one
  actionable race finding is corrected with exact consumer row locks, unit SQL
  ordering assertions, and a real PostgreSQL consumer-versus-retention proof.
  A fresh exact-head follow-up remains required before the plan can close.

## Verification

- Commands to be selected from the final diff: focused Web Vitest slices,
  PostgreSQL retention tests, Web typecheck and scoped lint,
  `git diff --check`, and identifier/privacy scans.
- Expected outcomes: bounded nonblocking maintenance, no foreground global
  cleanup, and preserved exact-row expiration and consumption semantics.
