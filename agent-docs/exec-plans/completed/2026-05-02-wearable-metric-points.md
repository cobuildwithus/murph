# Wearable Metric Points

## Goal

Land the supplied browser-vault wearable `MetricPoint` patch so biomarker pages can read latest private wearable values for resting heart rate, HRV RMSSD, REM sleep minutes, and deep sleep minutes.

## Scope

- Browser-vault/query projection code and focused query tests.
- Biomarker route/card surfaces directly coupled to the new private metric-point reader.
- No full SQLite query projection migration in this slice.

## Verification

- `pnpm --filter @murphai/query test browser-vault-metric-points` passed.
- `pnpm --dir apps/web test biomarker-browse-card health-commons-biomarker-detail-page` passed.
- `pnpm typecheck` passed.
- `pnpm test:smoke` passed.
- `pnpm --dir apps/web lint` passed with one unrelated warning in `apps/web/src/components/experiments/experiment-detail/protocol-tab.tsx`.
- `bash scripts/workspace-verify.sh test:diff ...` broadened into assistant-runtime reverse dependents and failed on unrelated hosted active-turn expectations.

## State

- Completed and landed.
