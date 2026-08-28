# Exact scheduled connection retry ownership

## Goal

Ensure a scheduled assistant job whose provider connection was lost is retried
at its persisted retry time, even when fresh conversation input or an unrelated
earlier reminder runs first.

## Constraints

- Keep one ephemeral exact-job retry obligation; add no durable state owner,
  scheduler, queue, service, dependency, or migration.
- Preserve fresh conversation priority and ordinary aggregate cron behavior.
- Revalidate the exact job at the retry deadline and no-op when its persisted
  state is stale, disabled, changed, completed, or already running.
- Leave device-sync behavior and ownership unchanged.

## Approach

1. Carry the exact job id and persisted retry time independently from aggregate
   assistant wake selection.
2. Let intervening conversation and unrelated cron work run without consuming
   the exact retry obligation.
3. Prove the T+10 input, T+20 unrelated reminder, and T+30 exact retry sequence
   with focused engine and hosted-runtime tests.
4. Complete required typechecks, guards, ReviewGPT review, and exact-head CI
   before merge.

## State

Implementation and focused verification complete; PR completion gates pending.
Status: completed
Updated: 2026-08-28
Completed: 2026-08-28
