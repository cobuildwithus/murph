# Hosted production 500 ReviewGPT remediation

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Close the nested interactive-transaction query fan-out found by final
  ReviewGPT round 1.
- Preserve the existing group-join confirmation, referral snapshot, billing
  action, and private-field encryption contracts without adding another owner.

## Finding

- Top-level group and referral helpers were serialized, but composed private
  member projections and subscription-action resolution still launched nested
  Prisma reads concurrently on the same interactive-transaction connection.
- Group-join confirmation read more identity state than its route requires,
  while the existing notification projection already owns the narrow
  phone-and-routing slice.
- Existing synthetic referral coverage mocked the nested usage-status owner and
  wrapped only four Prisma surfaces, so it could not reproduce the remaining
  overlap.

## Invariants

- Interactive transactions issue at most one database operation at a time.
- Crypto owners fetch all required private-field envelope metadata in one
  set-based read before parallel non-database unwrap and decrypt work.
- Group acceptance and referral arm or cancel commit once with their existing
  confirmation or snapshot.
- No new queue, service, durable state, dependency, or compatibility path.

## Tasks

1. [x] Reproduce both nested overlaps with single-query transaction guards.
2. [x] Batch identity, routing, and billing private-field envelope reads at the
   encryption owner.
3. [x] Route group-join confirmation through narrow assistant-notification
   member state and serialize that projection.
4. [x] Serialize usage-status action and offer reads, including nested member
   and billing eligibility queries.
5. [x] Exercise real secure-box projection plus real referral usage-status arm
   and cancel paths under guarded transaction clients.
6. [x] Run final local verification and close this plan for exact-head push.
7. [ ] Push the remediation head and complete ReviewGPT
   correction-verification round 2 with green CI.

## Verification

- Before the fix, the notification projection rejected a concurrent secure-box
  envelope query and the trial action graph silently lost its expected action.
- After the fix, both focused regressions passed.
- Ten affected hosted-web suites passed 237 tests, including full crypto,
  group-join, referral, usage-status, retention, runtime-log, and group helper
  coverage.
- Hosted-web prepared typecheck passed.
- `pnpm docs:drift` and `git diff --check` passed.
- Remediation-scoped `pnpm test:diff` passed every repository guard, then its
  web app step remained admission-blocked for ten minutes by three successive
  unrelated shared-host verification owners. The task-owned waiter was
  cancelled at the documented fallback threshold; final-head CI owns the full
  app proof.
Completed: 2026-07-28
