# Junction ambiguous optional-resource 422 skip

## Why

Since ~June 18, Junction's `GET /v2/summary/sleep_cycle` returns a 422 our
classifier cannot recognize for every Garmin connection. The provider treated
any unclassifiable 404/422 on an optional resource as a fatal retryable job
error (`JUNCTION_OPTIONAL_RESOURCE_RESPONSE_AMBIGUOUS`), which aborted the
whole reconcile before `importSnapshot` ran. Result: 1,200+ hourly reconcile
failures across all Garmin members, discarding already-fetched `activity` and
`sleep` summaries and skipping the timeseries import, for two weeks. Members
whose Junction connection delivers no sleep webhooks (for example
`hbm_i2FHE4iP0haKjclt`) had no working path to sleep data at all.

## Change

- An unclassifiable 404/422 on an optional Junction resource now skips only
  that resource (`reason: "ambiguous"`) instead of failing the job. The other
  summaries/timeseries in the same job still import.
- The provider's own error explanation (error code + redacted description via
  `sanitizeHostedRuntimeDiagnosticText`) is recorded on the skip warn log and
  in connection metadata as `junctionSkippedResourceLastDetail`, so operators
  can see from the prod DB why a resource is 422ing.
- Deleted the now-dead ambiguous error builder, safe-API-detail copier, the
  `junctionResourceDiagnostic*` failure metadata patch builder, and the
  service-level `failureMetadataPatch` error-details seam (junction was its
  only producer).

## Invariants

- Non-404/422 failures (5xx, auth, network) on any resource still fail the job
  and retry as before.
- Clear optional skips (`not_found` / `unavailable` / `unsupported`) behave
  exactly as before, now with an explicit `junctionSkippedResourceLastDetail:
  null`.
- Skip diagnostics must stay secret-safe: description text passes the shared
  hosted-runtime redactor before logging/persisting.

## Verification

- `pnpm --dir packages/device-syncd typecheck` — pass.
- `pnpm --dir packages/device-syncd test` — 649 tests pass, including the new
  regression: ambiguous `sleep_cycle` 422 still imports `activity` + `sleep`
  summaries and records the provider detail.
- `pnpm test:diff` from the worktree root before handoff.
Status: completed
Updated: 2026-07-02
Completed: 2026-07-02
