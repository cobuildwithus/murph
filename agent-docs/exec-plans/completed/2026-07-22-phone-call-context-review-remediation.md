# Remediate phone-call context ReviewGPT findings

Status: completed
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Bind an asynchronous phone-call result to the exact direct resident session
  that initiated the call.
- Make a causally earlier result available before planning the next accepted
  conversation turn, even when both mailbox lanes import in one runner pass.
- Keep internal result context inside the existing per-message UTF-8 history
  budget so multilingual payloads cannot hide the result or prior history.

## Accepted findings

1. Completion currently re-resolves mutable member notification routing instead
   of carrying the initiating session proof across the call lifetime.
2. Generic system-mailbox scheduling can defer a result that causally precedes
   fresh conversation input until after the response is planned.
3. The event accepts more UTF-8 bytes than one committed history message can
   retain, and the newest oversized entry can stop all earlier-history replay.

## Constraints

- Use the existing phone-call row, mailbox event, exact assistant-session store,
  and bounded pre-planning system phase; add no new owner, queue, scheduler, or
  reconciliation loop.
- Fail closed when initiating-session proof is missing, mismatched, or not a
  direct session; never fall back to mutable route resolution or create a new
  session for a result.
- Admit only call results whose existing mailbox causal sequence is not later
  than the accepted conversation batch frontier.
- Preserve untrusted-data framing, no automatic delivery, idempotent replay,
  and stale native-resume invalidation.
- Preserve unrelated changes in overlapping hosted-runtime and assistant
  planning lanes.

## Tasks

1. Add failing production-path coverage for dual-channel routing, same-pass
   causal ordering, and maximum multibyte result context.
2. Carry and persist exact origin session proof from the trusted assistant turn
   through call start and completion.
3. Extend the existing bounded pre-planning system phase for causally eligible
   result context.
4. Align producer, event parser, and transcript replay with the existing
   per-message UTF-8 byte budget.
5. Run focused and canonical verification, update the PR contract, push the new
   head, and complete ReviewGPT correction round 2 plus CI.

## Working set

- hosted phone-call start/result schema, Prisma row, migration, service, and
  focused Web tests
- assistant phone-call dynamic tool and exact-session context store/tests
- hosted result event contracts/parser and runtime consumer/tests
- bounded pre-planning system-mailbox phase and production-path tests
- current phone-call runtime/security/deployment docs and PR intent contract

Completed: 2026-07-22
