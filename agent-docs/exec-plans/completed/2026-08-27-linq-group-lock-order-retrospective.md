# Unify current Linq group transaction lock order

Status: completed
Created: 2026-08-27
Updated: 2026-08-27

## Goal

- Remove the remaining `message.received` versus `message.edited` PostgreSQL
  lock cycle by making every current Linq group path use the existing chat then
  member/route order.

## Success criteria

- Established group messages, active-group edits, and participant changes take
  the existing chat ownership lock before member or route locks.
- Group edit authority, correction lineage, mailbox append, and provider-event
  idempotency behavior remain unchanged.
- A real PostgreSQL two-client proof passes for group message receipt versus
  edit in both start orders and retains durable new-message and correction
  assertions.
- Existing participant-change concurrency schedules, focused Web checks,
  exact-head CI, and required ReviewGPT gates pass before merge.

## Scope

- In scope: the active-group edit transaction order, its production-composed
  PostgreSQL proof, and the matching reliability invariant.
- Out of scope: direct Linq message ordering, retries, queues, schema or state
  changes, new lock abstractions, and unrelated routing paths.

## Retrospective

- The first-reviewed PR aligned established group messages with participant
  changes only. That partial correction moved `message.received` to chat then
  member while active-group `message.edited` still locked member then chat
  during mailbox target validation.
- Both paths can operate on the same group chat and sender concurrently, so the
  inverse pair is a reachable PostgreSQL deadlock. The edit wrapper retries only
  stale lineage preparation and does not retry database deadlocks.
- Keep the smaller existing architecture: acquire the already-owned group chat
  lock before edit sender resolution and member locking, then let mailbox
  target validation reuse it in the same transaction. Add no new owner or
  coordination machinery.

## Tasks

1. Inventory current group chat/member/route lock acquisition and confirm the
   inverse edit path against the production transaction composition.
2. Reorder active-group edit acquisition at the existing planner boundary.
3. Add both-start-order real PostgreSQL proof with durable message and
   correction assertions, and retain participant-event proof.
4. Run focused tests, Web typecheck/lint, diff/privacy checks, and parent final
   review; update the PR evidence and exact-head metadata.
5. Close the plan in the scoped commit, push, retain the completed preliminary
   specialist pass, run the next final ReviewGPT round with CI, and
   merge/deploy/verify if all gates resolve.

## Verification

- Focused Vitest for Linq route/edit behavior.
- Opt-in real PostgreSQL Linq concurrency test.
- Web TypeScript and scoped ESLint.
- `git diff --check`, privacy/identifier guard, exact-head CI, ReviewGPT, and
  current-base merge-tree proof.

## Completed implementation evidence

- The active-group edit planner now acquires the existing chat ownership lock
  before resolving and locking the sender member. Mailbox target validation
  reuses that transaction-scoped lock; no new production owner, retry, queue,
  state, dependency, or abstraction was added.
- Before the correction, the production-composed edit-first PostgreSQL schedule
  reproduced `40P01` between the edit member lock and new-message chat lock.
  After the correction, both message-first and edit-first schedules complete
  and preserve one durable new message plus one immutable correction.
- The full opt-in PostgreSQL file passes 15/15 tests. Focused edit/route tests
  pass 156/156. Web typecheck, scoped ESLint, docs drift, and `git diff --check`
  pass.
- The routed diff verification passes 11,188 Web tests, app lint with zero
  errors, development smoke, production build, architecture/privacy guards,
  dependency policy, workspace boundaries, and provider/logging guards.
- Parent review confirmed the current shared order: established group receipt,
  active-group edit, participant addition/removal, route refresh/demotion, and
  mailbox target validation acquire or reuse chat ownership before member or
  route ownership.
Completed: 2026-08-27
