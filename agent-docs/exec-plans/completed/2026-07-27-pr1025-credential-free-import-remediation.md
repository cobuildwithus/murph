# PR 1025 credential-free import remediation

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Keep epoch-A provider credentials from authorizing any effect after an
  accepted epoch-B reconnect.
- Preserve already accepted, credential-independent imports until they reach a
  canonical terminal outcome.

## Round-two retrospective

The original requirement was to stop work admitted under an older
`connectedAt` epoch from running with replacement credentials. The first
reviewed head fenced wake and apply paths but left both durable work owners
under-fenced. The round-one remediation added reconnect cleanup to Web dirty
state and local SQLite jobs, plus webhook revalidation and dirty-marker
serialization.

That remediation grew authored production source from 143 additions and 13
deletions at the first-reviewed head to 282 additions and 14 deletions. The
growth added no new durable owner, but its preserve rule was incomplete: it
treated every non-HRV item as credential-scoped. That over-fence can delete an
accepted tombstone, companion metadata batch, or another inline import that
does not consume the replaced credentials.

The chosen correction is to shrink the cleanup predicate rather than add an
epoch column, queue, scheduler, manager, or reconciliation loop. One pure
classification derived from the existing provider, job kind, and payload facts
will be used by both durable owners:

- Oura, WHOOP, and Strava `delete` jobs are credential-independent tombstone
  imports and remain pending.
- Junction `resource` jobs carrying companion HRV, companion health metadata,
  or a summary `webhookDataJson` payload with the exact source provenance and
  sleep-cycle coverage required by the direct executor remain pending.
- Fetching work (`backfill`, `reconcile`, and provider resource jobs without an
  inline carrier), control work such as stale deauthorization, and unknown
  shapes remain connection-epoch scoped and are retired.
- Compact Web dirty markers have no authoritative inline payload and remain
  connection-epoch scoped.

This keeps the existing Web dirty rows and SQLite jobs as the only durable
owners. The accepted inline payload itself remains the source of truth; no
compatibility state or replacement lifecycle is introduced.

## Approach

1. Add the shared executor-faithful classification at the existing hosted job
   boundary.
2. Narrow Web reconnect cleanup to delete only credential-scoped payload rows
   while retaining tombstones and all supported Junction inline imports.
3. Narrow runtime epoch cleanup to dead-letter only credential-scoped queued
   and running jobs inside the existing hydration transaction.
4. Add production-boundary regressions for accepted delete and companion
   payloads across reconnect, local queued/running work, epoch-B work,
   credential-scoped work, and the existing lock/ack and stale-webhook paths.
5. Update the ingestion invariant to name the full credential-independent
   preserve class.
6. Run focused tests and typechecks, canonical diff verification, full
   acceptance, parent review, ReviewGPT correction verification, and exact-head
   CI.

## Evidence

- Focused regressions:
  - device-sync hosted-runtime, store, and Junction provider: 333 passed.
  - assistant-runtime reconnect/import sequence: 78 passed.
  - Web dirty-connection and OAuth store coverage: 53 passed.
  - isolated Cloudflare hosted-runner smoke: 1 passed.
- Focused typechecks passed for core, importers, device-syncd,
  assistant-runtime, and Web. The core and importers package builds and the
  workspace source-resolution test also passed.
- `MURPH_VERIFY_EXECUTOR=local pnpm test:diff ...` passed for the complete
  correction scope:
  - all affected package typechecks and package-boundary checks passed;
  - representative totals include assistant-engine 2,749, assistant-runtime
    1,900, CLI 1,083, core 761, device-syncd 865, importers 381, and Web 6,870
    passing tests;
  - Cloudflare passed 1,992 node tests and 2 Workers tests;
  - Web lint completed with zero errors, dev smoke passed, and the production
    build passed without the broad file-tracing warning reproduced by the
    first correction attempt.
- `MURPH_VERIFY_EXECUTOR=local pnpm verify:acceptance` passed. The full
  workspace typecheck, documentation and artifact hygiene, package coverage,
  package-boundary checks, Web verification, and Cloudflare verification all
  completed successfully.

## Deployment

- Keep the existing runner-first order. Deploy the corrected
  Cloudflare/runner bundle and verify its exact fingerprint before Web begins
  using the corrected reconnect cleanup.
- The correction uses existing schema and durable owners; no migration is
  required.
Completed: 2026-07-27
