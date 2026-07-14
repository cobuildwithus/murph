# PR 559 final audit remediation

## Goal

Resolve the four validated final ReviewGPT findings without weakening the
companion privacy boundary or adding another retry owner.

## Success criteria

- Encrypted dirty payload rows remain the durable retry authority until their
  canonical import succeeds; a yield, retryable importer failure, checkpoint,
  or cold restore cannot erase accepted WHOOP RMSSD work.
- Existing exact capture receipts answer stale and disconnected retries before
  first-admission freshness and connection-liveness gates; changed content
  still conflicts and unseen work still fails closed.
- The exact original-plus-opaque pre-v8 terminal fork consolidates onto the
  hosted-bound account even when an active snapshot bound the original row
  first; every other collision remains fail-closed.
- Capture receipts have explicit Postgres ownership, indexed 30-day lazy
  retention, a hard 1,024-row per-connection limit, and documented snapshot
  treatment.
- Focused owner tests/typechecks, required completion audits, final-head
  ReviewGPT, GitHub CI, and final head/review/mergeability gates pass.

## Working set

- `packages/assistant-runtime/src/hosted-device-sync-runtime.ts`
- `packages/assistant-runtime/src/hosted-runtime/device-sync-maintenance.ts`
- `packages/assistant-runtime/test/hosted-device-sync-runtime.test.ts`
- `packages/device-syncd/src/store/hosted-account-hydration.ts`
- `packages/device-syncd/test/store.test.ts`
- `apps/web/app/api/device-sync/companion/hrv-rmssd/route.ts`
- `apps/web/src/lib/device-sync/{companion,public-ingress-service,wake-service}.ts`
- `apps/web/src/lib/device-sync/prisma-store{,/dirty-connections}.ts`
- `apps/web/prisma/schema.prisma` and the unshipped companion-receipt migration
- Matching focused tests and durable architecture/security/device-sync docs.

## Persisted-state classification

The encrypted dirty payload remains existing web-owned durable handoff state.
The receipt remains sparse replay-control metadata in Postgres, never health
truth: it stores only fixed-size hashes, is excluded from runtime snapshots,
expires lazily after 30 days, and is capped at 1,024 rows per connection.

## Verification plan

- Production-path runtime tests for yield immediately after dirty sync,
  retryable importer failure, checkpoint acknowledgement, cold restore, and
  exactly-once canonical outcome.
- Route/store tests for stale exact replay, stale changed replay, unseen stale
  work, exact replay after disconnect, unseen work after disconnect, retention,
  and capacity.
- Store/runtime migration test for active-first binding followed by terminal
  legacy-fork consolidation with jobs and sources preserved.
- Focused web, device-syncd, and assistant-runtime tests/typechecks followed by
  repository-routed verification and serialized completion audits.
- Scoped plan-closing commit and push, then one substantive clean ReviewGPT
  audit on the final PR-specific correction head and green GitHub checks.

## External proof limitation

The real 60-second capture-to-query proof still requires the owned physical
iPhone/WHOOP surface and authenticated session. It must not be simulated.

## Completion evidence

- Focused web receipt, ingress, route, and migration tests: 180/180 passed.
- Focused assistant-runtime dirty-handoff and maintenance tests: 130/130 passed.
- Web, assistant-runtime, and device-syncd owner typechecks passed.
- The diff-aware affected-owner lane passed all WHOOP-owned and affected
  package checks except one interactive setup-cli selection assertion while
  packages ran concurrently; that unrelated file passed 6/6 immediately in an
  isolated rerun.
- `pnpm docs:drift`, `git diff --check`, and the scoped identifier/credential
  pattern scan passed.
- The serialized final security/privacy audit is clean. Its initial terminal
  non-RMSSD candidate was rejected against the explicit disconnect contract:
  provider-dependent work is terminally dispositioned, while accepted
  credential-free companion RMSSD alone survives for canonical import.
- The serialized final coverage-write audit is clean with no edits and no
  remaining important executable-proof gap.

## Final review decisions

- Receipt lookup remains replay-first, but only within the bounded retained
  window; expired identity is treated as new admission.
- An RMSSD dirty payload id is withheld until its mapped local job proves
  canonical import. The invocation-local mapping is deliberately not restored;
  the retained encrypted web payload is the cold-start retry authority.
- A local job marked successful only because terminal execution was skipped is
  not canonical success and cannot release the RMSSD payload.
- Terminal provider-dependent payloads retain their established disposition
  semantics and are not converted into an unprocessable forever-dirty queue.

## State

Active.

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
