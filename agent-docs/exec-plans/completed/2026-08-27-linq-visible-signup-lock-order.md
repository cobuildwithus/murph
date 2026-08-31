# Align visible signup transport with Linq chat lock order

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Prevent the supported stale-direct-wake to current-group-route transition
  from deadlocking visible signup reconciliation against an active group edit.

## Success criteria

- Existing-chat signup dispatch takes the Linq chat ownership lock before the
  member row, while create-chat fallback remains member-only.
- A production-composed PostgreSQL proof runs visible reconciliation against a
  signed active-group edit in both start orders without `40P01`.
- The stale personal signup sends nothing, terminates on non-retryable live
  route authority, the edit records one immutable correction, and neither
  effect duplicates.
- Focused checks, exact-head CI, same-thread ReviewGPT, merge, deploy, and
  bounded production health proof complete.

## Scope

- In scope: existing-chat signup dispatch order, the exact visible-reconciliation
  versus group-edit regression, and matching reliability documentation.
- Out of scope: direct-ingress ordering, retries, queues, schema changes, new
  state owners, lock APIs, managers, leases, and unrelated routing paths.

## Constraints

- Technical constraints: reuse the existing transaction, chat lock, member row
  lock, route authority, delivery disposition, and test harness.
- Product/process constraints: preserve provider suppression after takeover,
  keep database-only transactions bounded, and stop on any new final finding.

## Risks and mitigations

1. Risk: moving the chat lock could change create-chat or persisted signup
   recovery behavior.
   Mitigation: branch only when the original signup payload targets an existing
   chat, preserve member-only fallback, and revalidate all mutable state under
   the same transaction.
2. Risk: a helper-level test could miss the production composition that caused
   the finding.
   Mitigation: call the actual visible reconciliation entrypoint and signed edit
   transaction with two real PostgreSQL clients in both start orders.

## Tasks

1. Reorder only existing-chat signup transport ownership to chat then member.
2. Add both-start-order PostgreSQL regression with durable correction,
   no-provider-send, non-retryable route-authority, and no-duplicate assertions.
3. Update the durable Linq lock-order invariant and complete focused proof.
4. Commit, push the exact PR head, run same-thread ReviewGPT with CI, and land,
   deploy, verify, and retire on PASS.

## Decisions

- Keep the existing route authority and delivery owners; add no coordination
  abstraction or retry path.
- Scope the chat-first order to an existing signup chat; leave create-chat
  fallback member-only and avoid reacquiring the same chat lock later in the
  transaction.

## Verification

- Focused transport regression: passed with one selected test and 77 skipped.
- Opt-in real PostgreSQL concurrency file: 17 of 17 tests passed in 553.96
  seconds, including both reconciliation-first and edit-first schedules.
- Remote affected-app candidate
  `4e8eb6de8b76d154f3dbb632f851d3a3733ee341`: passed Web typecheck, 11,189
  tests, lint, build, and affected-app verification.
- `git diff --check`: passed.
- No qualifying new developer friction required a Frog entry.
- Exact-head CI, ReviewGPT, merge, deploy, and production health proof remain
  completion-lane actions after this implementation commit.
Completed: 2026-08-27
