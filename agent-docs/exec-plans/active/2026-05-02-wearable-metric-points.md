# Wearable Metric Points

## Goal

Land the supplied browser-vault wearable `MetricPoint` patch so biomarker pages can read latest private wearable values for resting heart rate, HRV RMSSD, REM sleep minutes, and deep sleep minutes.

## Scope

- Browser-vault/query projection code and focused query tests.
- Biomarker route/card surfaces directly coupled to the new private metric-point reader.
- No full SQLite query projection migration in this slice.

## Verification

- `pnpm --filter @murphai/query test browser-vault-metric-points`
- `pnpm typecheck`
- Additional required scoped checks based on the final touched file set.

## State

- Registered before applying the supplied patch.
