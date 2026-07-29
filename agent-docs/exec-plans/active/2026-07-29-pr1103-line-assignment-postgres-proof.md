# Prove PR 1103 line assignment against PostgreSQL

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Add the missing real-PostgreSQL regression proof that concurrent direct
  Telegram `imessage_contact` requests compose the existing member-route lock,
  line-pool reservation, and encrypted routing persistence primitives into one
  idempotent home-line assignment.

## Success criteria

- Two concurrent handler calls for one eligible member converge on the same
  persisted Linq recipient phone.
- The test exercises real PostgreSQL transactions and the production routing
  primitives rather than mocking their orchestration.
- The assigned line remains a bare home line: no chat binding and no proactive
  capacity claim are created.
- The focused opt-in PostgreSQL suite passes and its CI coverage description is
  accurate.

## Scope

- In scope: the existing hosted Linq home-routing PostgreSQL suite, the test map
  that documents its coverage, focused verification, and PR completion gates.
- Out of scope: production handler changes, new routing abstractions, activation
  or welcome delivery, Linq chat creation, and proactive-capacity behavior.

## Constraints

- Reuse current fixtures and opt-in PostgreSQL infrastructure.
- Keep production code unchanged unless the test proves an actual defect.
- Preserve the exact direct-Telegram, verified-phone eligibility boundary.

## Tasks

1. Build a real mailbox wake, member identity, runtime-access grant, and healthy
   Linq pool line using existing test helpers.
2. Drive concurrent handler requests through independent real Prisma clients
   while a third transaction proves both wait on the member route lock.
3. Assert one encrypted persisted assignment, the same returned phone, no chat
   binding, and no proactive-capacity mutation.
4. Run the focused PostgreSQL suite, inspect the diff, complete the required
   coverage review, then commit, push, and open the test-only PR.

## Decisions

- Extend the existing opt-in home-routing PostgreSQL suite so the current hosted
  E2E database job remains the single owner of this proof.
- Use the existing route-lock primitive to make the race deterministic instead
  of adding sleeps or production test hooks.

## Verification

- Pending.
