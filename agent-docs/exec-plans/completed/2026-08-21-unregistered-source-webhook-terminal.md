# Stop dead-lettering webhooks for sources Murph never registered

Status: completed
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Let hosted webhook admission finish, instead of retrying forever, when a
  confirmed device connection receives a source-attributed event for a source
  that was never registered on our side.

## Success criteria

- A focused regression test reproduces the current infinite
  `WEBHOOK_SOURCE_NOT_READY` loop for a confirmed connection with no
  `device_connection_source` row for the event's source slug.
- The same event completes its webhook trace and admits no data.
- A connection still in setup keeps the retryable behavior, so the existing
  connect race stays recoverable.
- An existing registered source that is disconnected, fenced, or mid-admission
  keeps its current retry and terminal behavior.
- Focused hosted Web tests pass on the final file state.

## Scope

- In scope: the durable admission decision in
  `apps/web/src/lib/device-sync/wake-service.ts` and its focused coverage.
- Out of scope: registering unknown sources from provider listings, Queue retry
  policy, dead-letter retention, monitor thresholds, and the DLQ redrive itself.

## Constraints

- Keep the consent boundary: an unregistered source still admits no data.
- Keep provider I/O outside database transactions.
- Smallest durable correction; no new state, queue, or abstraction.

## Risks and mitigations

1. Risk: a real source registration that is still in flight gets dropped.
   Mitigation: source rows are created when Murph starts a source connect, so
   only a confirmed connection with no row is treated as terminal; pending setup
   keeps retrying.
2. Risk: silently losing health data.
   Mitigation: the event carries no admissible data for an unregistered source,
   and scheduled reconcile keeps pulling for registered sources.

## Steps

1. Reproduce the loop in a focused test.
2. Make the confirmed-connection, unregistered-source case complete the trace.
3. Prove pending setup and registered-source paths are unchanged.
4. Open the PR, run the routed review gates, then redrive the dead-letter queue
   after the Web deploy is live.
Completed: 2026-08-21
