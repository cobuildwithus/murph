# Remove repeated runtime authority reads

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

Reduce serial database work before runtime processing. Authorization previously
locked the member and runtime owner, then selected both rows again. Return the
needed data from the existing locks and delete the repeat reads.

## Success criteria

- Prove callback authority needs three queries instead of five, preserving the
  complete owner row and existing concurrency guarantees.
- Preserve typing placement, alert thresholds, mailbox ordering, and assistant
  inputs. No prompt/model journey is needed for this database-only change.

## Scope

- Reuse the owner lock result for claim, callbacks, provider authorization,
  target retirement, and deletion readiness.
- This bounded optimization does not resolve every message-latency cause.
  Investigation also located time outside application request handlers and in
  cold workspace restoration. No deployment or production speedup is claimed.
  Private diagnostic rows and incident identifiers are not retained here.

## Constraints

- Preserve gate -> member -> owner lock ordering and transaction boundaries.
- Preserve deleted-member rejection, exact attempt/generation validation, and
  starting/active phase checks. No cached authorization or new state.
- Keep native bigint and timestamp values; do not serialize authority through
  JSON or weaken generation precision.

## Risks and mitigations

1. A stale row or lost bigint precision could grant incorrect authority.
   Mitigation: real PostgreSQL contention tests and full-row comparison using
   generation/workspace values above JavaScript's safe integer range.

## Tasks

1. Reproduce repeated reads against isolated PostgreSQL and remove them.
2. Run relevant callback/concurrency tests, typecheck, and candidate review.
3. Commit and complete applicable external review and exact-head CI.

## Decisions

- Product UX: Ready. Individual and group reply preparation does less repeated
  database work. Existing-owner wakes, new claims, stale attempts, revocation,
  deletion, and cleanup retain their current outcomes. Production timing proof
  requires deployment and later observation; transport stalls remain unresolved.

## Verification

- The new PostgreSQL regression failed on the original code: five queries
  instead of three. It passes after consolidation and compares the full row.
- All 39 runtime ownership PostgreSQL tests pass, including contention,
  competing claims, retirement, rollback, and deleted-member rejection.
- Web typecheck passes. Complexity diff passes with zero debt and unchanged
  maximum complexity (14).
- Adjacent callback, usage, migration, and member-cutover suites pass (147 tests).
  The cutover proof first rejected the development database name; it passed in
  its required isolated `murph_test_*` database. Changed-file ESLint, docs drift,
  and privacy/diff checks pass.
- Parent review confirms native row types, lock order, and unchanged admission
  decisions. Implementation is committed; PR #3601 owns final external review
  and exact-head CI. These external gates remain pending at local closeout.
- Changelog: `2026-09-20/less-repeated-reply-preparation`; existing archive
  presentation is unchanged. No production mutation or deployment was performed.
Completed: 2026-09-20
