# PR 1025 durable epoch-work remediation

Status: active
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Ensure work admitted under an older device-connection `connectedAt` epoch
  cannot execute against replacement credentials after reconnect.
- Preserve same-epoch retries and the existing authorization-independent
  companion-HRV path.

## Proven cause

- The current patch fences connection-scoped wake envelopes and runtime apply
  writes, but local device jobs and hosted dirty state are durable effect
  owners of their own.
- Local account hydration replaces credentials in place without retiring
  queued or leased credential-scoped jobs from the previous epoch.
- Hosted webhook acceptance writes dirty state after reading the connection
  epoch but does not revalidate that epoch under the existing connection lock.
- The reconnect transaction reuses the connection id without superseding
  already-pending credential-scoped dirty work.

## Constraints

- Keep `connectedAt` as the only connection-epoch authority.
- Use the existing SQLite immediate transaction and Web connection advisory
  lock; add no persisted epoch column, queue, service, or reconciliation owner.
- Preserve companion-HRV jobs and encrypted dirty payloads because their
  accepted content is authorization-independent.
- Fail stale webhook admission closed while completing the claimed trace
  terminally, so exact redelivery remains idempotent.

## Approach

1. Add a failing local-runtime regression proving that hydration from epoch A
   to epoch B leaves an epoch-A job runnable under the current patch.
2. In the existing hydration transaction, mark queued and running
   credential-scoped jobs dead when an accepted snapshot changes
   `connectedAt`, retaining the existing companion-HRV exception.
3. Add Web regressions for both reconnect cleanup and the read-A/commit-B
   webhook admission race.
4. Revalidate webhook epoch under the existing connection mutation lock.
5. In the reconnect transaction, mark compact dirty work processed and delete
   non-companion encrypted payloads while retaining companion-HRV payloads.
6. Run focused tests and typechecks, canonical diff verification, full
   acceptance, parent review, ReviewGPT correction verification, and exact-head
   CI.

## Deployment

- Keep the existing runner-first order. Deploy the epoch-aware runner and
  verify its exact bundle fingerprint before Web begins emitting the fenced
  wake and reconnect behavior.
- The Web correction uses existing schema and is safe after the runner floor is
  established.

