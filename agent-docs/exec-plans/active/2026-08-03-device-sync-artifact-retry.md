# Device-sync artifact retry correctness

## Goal

Prevent transient hosted artifact-store failures from killing otherwise replay-safe device-sync jobs, while preserving fail-closed behavior for validation, authorization, and programming errors.

## Proven production symptom

- Hosted runtime logs recorded transient artifact upload transport failures on device-sync resource and backfill jobs.
- The device-sync service normalized those generic errors as non-retryable `SYNC_JOB_FAILED`, so the affected jobs were dropped.
- Junction profile-summary 404 responses already skip only that optional resource; they are not part of this fix.
- Source-less Junction SDK accounts are an intentional pre-provider state. Any retry-loop change must preserve webhook admission and initial historical recovery after a provider is selected.

## Success criteria

- Hosted artifact upload transport timeouts, connection failures, and retryable HTTP responses reach device-sync as a stable retryable error.
- Device-sync jobs remain queued with backoff after those failures instead of becoming dead.
- Non-retryable HTTP responses, malformed data, and unexpected programming errors retain their existing terminal behavior.
- No provider payload, credential, member identifier, or local path enters diagnostics or fixtures.
- Source-less SDK behavior changes only if a focused test proves history can be restarted from existing durable source/webhook state.

## Implementation

1. Add focused failing tests at the hosted importer/device-sync boundary.
2. Add the smallest boundary translation needed to preserve retry metadata.
3. Evaluate the source-less historical retry loop and either make a proven safe simplification or leave it unchanged with the reason recorded.
4. Run focused package tests and typechecks plus a direct retry-state scenario.
5. Push an exact candidate, run required CI and ReviewGPT gates, resolve accepted findings, and close this plan with the final scoped commit.

## Verification

- The hosted importer regression proves a retryable artifact write leaves the
  device-sync job queued, while a terminal write leaves it dead with the same
  stable error code.
- Cloudflare artifact-store coverage proves transport, 408, 429, and 5xx
  failures are retryable; 422 is terminal; existing authority rejection
  coverage remains green.
- The existing Junction profile test proves summary-profile 404 is imported as
  a one-shot optional skip instead of failing the sync.
- The existing SDK sign-in suite proves source-less setup remains
  `source_confirmed`, seeds initial jobs, and schedules reconciliation. Production
  evidence showed successful job completion without current errors, so this
  intentional pre-provider recovery state is unchanged.
- Focused package tests and both affected package typechecks pass locally.
