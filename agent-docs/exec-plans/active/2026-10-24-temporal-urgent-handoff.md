# Urgent wearable handoffs independent of sweep cadence

Status: active
Created: 2026-10-24

## Outcome and invariant

Urgent Junction sleep/workout hints must release an existing routine batch through the immediate mailbox path. Routine totals retain their fifteen-minute coalescing window. Consent, connection identity, trace claims and exactly-once durable handoff remain owned by the existing admission transaction.

## Evidence and design

The five-minute reconciler exposed a production-path integration timeout: activity opens a routine batch, sleep advances its deadline, but no mailbox item exists until a sweep. The progress probe allows three minutes, shorter than the new sweep interval. Preserve urgency by replacing deadline advancement with an atomic claim that clears an existing deadline and returns whether this transaction must append the ordinary dirty-transition wake. Prepare its existing mailbox crypto before the transaction. No new state, scheduler or post-commit owner.

## Product UX

Outcome: sleep and workouts do not wait behind batched daily totals.
Reaches: urgent clean transitions, urgent arrivals during routine batches, repeated urgent hints, routine-only hints, consent denial and failed signaling.
Proof: focused ingress tests, real PostgreSQL claim/concurrency and rollback proof, and the existing signed Junction replay integration with five-minute cadence.

## Verification and rollout

Run focused Web tests and typecheck, database proof, complexity and doc checks. Use final ReviewGPT and exact-head PR CI. Deploy the additive Web correction before changing the live Schedule. Then rerun the Temporal release integration against the corrected public main. Old Web retains its prior sweep-based behavior until convergence. A failed immediate signal leaves the durable mailbox recovery owner intact.
