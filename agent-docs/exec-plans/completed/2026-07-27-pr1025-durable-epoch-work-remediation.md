# PR 1025 durable epoch-work remediation

Status: completed
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

## Evidence to date

- Final ReviewGPT round 1 on exact head
  `8ed25ecbbe5783af25fcdf53ad718b5f31f477fe` proved that wake and apply
  fencing alone left epoch-A local jobs and hosted dirty work runnable under
  epoch-B credentials.
- The pre-fix local runtime regression left the seeded epoch-A job queued after
  hydrating epoch B. The correction now terminalizes running, retryable,
  future-dated, deauthorization, delete, resource, and reconcile work with
  `HOSTED_CONNECTION_EPOCH_REPLACED`.
- The stale webhook admission regression proves that an epoch change between
  ingress read and dirty-state commit completes the claimed trace without
  writing dirty state or a wake.
- The reconnect cleanup regression proves that credential-scoped encrypted
  payloads are deleted while an authorization-independent companion-HRV
  payload remains pending. The cleanup locks the dirty-marker row inside the
  existing reconnect transaction, so a concurrent runtime acknowledgement
  serializes instead of aborting credential replacement.
- The two assistant-runtime owner files pass all 151 tests; the three focused
  Web owner files pass all 144 tests. Device-syncd, assistant-runtime, and
  hosted Web typechecks, scoped Web lint, and documentation drift checks pass.
- Canonical local `pnpm test:diff` passed on rerun across every selected owner
  and affected workspace lane, including 6,870 Web tests, 1,992 Cloudflare Node
  tests, and both Cloudflare Workers tests. The first final attempt hit the
  unchanged 1 ms preference-handoff timing case after 6,869 other Web tests
  passed; its exact isolated suite then passed all 9 tests in 16 ms before the
  complete canonical rerun went green.
- Full local `pnpm verify:acceptance` passed across all package coverage,
  6,870 Web tests, the Web production build, 1,992 Cloudflare Node tests, and
  both Cloudflare Workers tests.

## Deployment

- Keep the existing runner-first order. Deploy the epoch-aware runner and
  verify its exact bundle fingerprint before Web begins emitting the fenced
  wake and reconnect behavior.
- The Web correction uses existing schema and is safe after the runner floor is
  established.
Completed: 2026-07-27
