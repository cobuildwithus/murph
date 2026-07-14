# PR 611 ReviewGPT Round 4

## Goal

Make the two-variable rollout configuration handshake fail closed so a partial
provider write cannot enable confirmations without current private-route authority
or let a workflow exit green without the required drain.

## Constraints

- Write the rollout bearer before enabling the producer.
- An enabled but unauthorized deployment repairs authority and then fails.
- Keep normal production releases as the sole alias owner.
- Add no durable rollout state or deployment mutation.

## Verification Plan

- Focused tests for token-write failure, enabled-without-authority repair/failure,
  disabled configuration-only setup, and enabled authorized cursor drain.
- Hosted-web typecheck, docs drift, diff check, and parent final review.
- Guarded push, CI, and a fresh exact-head ReviewGPT round.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
