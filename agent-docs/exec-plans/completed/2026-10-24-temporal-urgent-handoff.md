# Urgent wearable handoffs independent of sweep cadence

Status: completed
Created: 2026-10-24

## Outcome and invariant

Urgent Junction sleep/workout hints must release an existing routine batch through the immediate mailbox path. Routine totals retain their fifteen-minute coalescing window. Consent, connection identity, trace claims and exactly-once durable handoff remain owned by the existing admission transaction.

## Evidence and design

The five-minute reconciler exposed a production-path integration timeout: activity opens a routine batch, sleep advances its deadline, but no mailbox item exists until a sweep. The progress probe allows three minutes, shorter than the new sweep interval. Preserve urgency by replacing deadline advancement with an atomic claim that clears an existing deadline and returns whether this transaction must append the ordinary dirty-transition wake. Use the existing bounded preparation replan if the final transaction discovers an unprepared urgent batch; the claim rolls back before crypto preparation outside the lock. No new state, scheduler or post-commit owner.

## Product UX

Outcome: sleep and workouts do not wait behind batched daily totals.
Reaches: urgent clean transitions, urgent arrivals during routine batches, repeated urgent hints, routine-only hints, consent denial and failed signaling.
Proof: focused ingress tests, real PostgreSQL claim/concurrency and rollback proof, and the existing signed Junction replay integration with five-minute cadence.

## Verification and rollout

Run focused Web tests and typecheck, database proof, complexity and doc checks. Use final ReviewGPT and exact-head PR CI. Deploy the additive Web correction before changing the live Schedule. Then rerun the Temporal release integration against the corrected public main. Old Web retains its prior sweep-based behavior until convergence. A failed immediate signal leaves the durable mailbox recovery owner intact.

## Completion evidence

- Reproduced the missing immediate append before implementation.
- Focused wake suite: 215 passed, including immediate release, ordinary coalescing, routine batching, migration admission and crypto preparation boundaries.
- Real PostgreSQL retention suite: 43 passed with two pooled connections, including competing claims, owner isolation, transaction rollback and sweep recovery.
- Web typecheck passed. Complexity guard passed; wake-service debt decreased from 106 to 102. The existing admission and transaction hotspots retain their authority boundaries.
- Parent review: Ready. No schema, provider payload, assistant prompt, tool or notification-policy change. No new scheduler, table or delivery owner. Mailbox signals remain after commit and recovery survives signal failure.
- PR #4350 owns final ReviewGPT and exact-head CI. The protected five-minute integration replay and production convergence remain deployment gates in the authorized rollout.
Updated: 2026-10-24
Completed: 2026-10-24
