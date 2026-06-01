# Junction SpO2 Daily Facts

## Goal

Make Junction/Garmin blood oxygen visible in browser-vault biomarkers by deriving compact daily SpO2 facts from `blood_oxygen` timeseries.

## Constraints

- Keep dense timeseries as raw/debug evidence only.
- Do not emit per-sample browser-vault rows.
- Prefer the existing wearable metric projection path over a new vault-specific surface.
- Preserve unrelated active hosted-local and research work.

## Working Set

- `packages/importers/src/device-providers/junction.ts`
- `packages/importers/src/device-providers/metric-catalog.ts`
- `packages/importers/test/device-providers-junction.test.ts`
- `packages/query/src/wearables/**`
- `packages/query/src/metrics/**`
- `packages/health-commons/content/biomarkers/blood-oxygen-spo2.md`
- `apps/web/src/components/biomarkers/biomarker-detail/biomarker-private-trend-card.tsx`
- `apps/web/src/components/ui/metric-card.tsx`
- `apps/web/test/biomarker-layout-client.test.tsx`
- `packages/cli/src/commands/wearables.ts`
- focused query tests as needed
- focused web/CLI tests as needed

## Verification

- Focused importer tests for Junction blood oxygen normalization.
- Focused query/browser-vault metric coverage for SpO2 and lowest SpO2.
- Focused web card coverage for secondary biomarker metric bindings.
- Focused CLI schema coverage for `lowestSpo2`.
- Repo-required typecheck/smoke where feasible.

## State

- Junction `blood_oxygen` timeseries now derives daily `spo2` mean and `lowest-spo2` minimum display facts.
- Dense SpO2 samples remain raw Junction evidence only.
- Browser-vault biomarker lookup prefers the Health Metrics primary metric when primary and secondary metrics share a biomarker key.
- Blood oxygen Health Commons bindings expose `lowest-spo2` as secondary private context.

## Final Verification

- `pnpm exec vitest run packages/importers/test/device-providers-junction.test.ts packages/query/test/browser-vault-replica-coverage.test.ts packages/query/test/browser-vault-metric-points.test.ts packages/cli/test/wearables-schema.test.ts`: passed.
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/biomarker-private-trend-card.test.ts test/biomarker-layout-client.test.tsx --no-coverage`: passed.
- `pnpm --filter @murphai/importers typecheck`: passed.
- `pnpm --filter @murphai/query typecheck`: passed.
- `pnpm --filter @murphai/health-metrics typecheck`: passed.
- `pnpm --dir apps/web typecheck`: passed.
- `pnpm --dir apps/web lint`: passed with one unrelated warning in `apps/web/test/device-sync-hosted-runtime-authority.test.ts`.
- `pnpm --dir packages/importers test:coverage`: passed.
- `pnpm --dir packages/query test:coverage`: passed.
- `pnpm --dir apps/web test:prepared`: passed.
- `pnpm --dir packages/cli verify:coverage`: passed.
- `pnpm --dir packages/health-commons verify`: passed.
- `pnpm typecheck`: blocked by unrelated `scripts/hosted-local-e2e.test.ts` TypeScript errors.
- `bash scripts/workspace-verify.sh test:diff ...`: blocked by the same unrelated `scripts/hosted-local-e2e.test.ts` TypeScript errors.
- Visual smoke: local SpO2 biomarker page returned HTTP 200; desktop/mobile screenshots were nonblank and clean. Browser plugin backend was unavailable, so screenshots were captured through the web workspace Playwright CLI.
Status: completed
Updated: 2026-06-01
Completed: 2026-06-01
