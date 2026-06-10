# Device-Sync Job Failure Observability

Date: 2026-06-09
Status: completed

## Problem

Verified production incident (June 8-9, 2026): Junction `listSummary` fetches started failing,
so every WHOOP sleep resource job threw on every attempt, yet no `device-sync.job_failed`
row reached `hosted_runtime_log` and `device_connection.last_sync_error_at` stayed null.
A two-day fleet-wide ingestion outage looked like "sync healthy, no errors."

Root cause (code-path evidence):

1. `packages/device-syncd/src/service.ts:940` — the worker catch records the per-attempt
   failure only via `this.logger.warn`. The hosted runtime constructs the service without a
   `log` (`packages/assistant-runtime/src/hosted-runtime/maintenance.ts:1709-1717`), so the
   logger defaults to `console` (`service.ts:214`) — ephemeral container stdout.
2. The only durable `device-sync.job_failed` writer on the sync-pass path
   (`maintenance.ts:1368-1418`, called at `maintenance.ts:935`) keys off account-level
   `lastSyncErrorAt` deltas (`maintenance.ts:1394`).
3. `markSyncSucceeded` (`packages/device-syncd/src/store/sync-state.ts:86-102`) nulls
   `last_sync_error_at`/`last_error_code` on any later job success for the same account.
   During the incident every webhook wake also ran direct-import (activity) jobs that
   succeeded after the failing sleep summary jobs, erasing the failure before the post-drain
   writer ran — so neither the log nor the control-plane reconcile ever saw the failure.

## Smallest durable change

Drive the durable `device-sync.job_failed` log from the per-attempt failure diagnostics the
worker already records at the moment of failure (`service.ts:900`,
`listJobFailureDiagnostics()`), which are immune to later success-clears:

- `packages/device-syncd`: extend `DeviceSyncJobFailureDiagnostic` with optional secret-safe
  job metadata (`at`, `provider`, `jobKind`, `resource`, `attempts`, sanitized `summary`)
  recorded in the existing worker catch. No new services or state.
- `packages/assistant-runtime`: rework `writeHostedDeviceSyncJobFailureRuntimeLogs` to emit
  one `device-sync.job_failed` entry per recorded failure diagnostic (webhook wakes and idle
  maintenance both flow through `runHostedDeviceSyncPass`), keeping the existing
  account/baseline enrichment and redaction helpers.
- Control plane: `reconcileHostedDeviceSyncControlPlaneState` already propagates
  `lastSyncErrorAt`/`lastErrorCode`/failure diagnostics through the existing port when the
  failure is the connection's latest state; per-attempt control-plane propagation would need
  a new contract surface, so it is intentionally not built (TODO noted in handoff).

## Tests

- `packages/device-syncd/test/service.test.ts`: failed job records diagnostic with job
  metadata.
- `packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`: webhook-wake
  resource-job failure logs `device-sync.job_failed` with expected metadata even when a later
  success cleared account error state; existing newly-failed-account log shape stays covered.
- Idle-maintenance failure logging (`hosted-runtime-workspace-assistant-phase.test.ts`)
  unchanged and still green.

## Verification

Targeted vitest for touched files in `packages/device-syncd` and `packages/assistant-runtime`
plus package typechecks. No full e2e harness.
Updated: 2026-06-09
Completed: 2026-06-09
