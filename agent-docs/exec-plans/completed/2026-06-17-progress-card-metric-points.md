# Progress Card Metric Points

## Goal

Make experiment progress-card movers use the same display-grade metric-point data that powers the hosted browser experiment detail page, so cards do not show an empty marker state when the web run has qualifying biomarker deltas.

## Scope

- `packages/query/src/experiments.ts`
- focused experiment progress/card tests in `packages/query/test/experiment-analysis.test.ts`
- `packages/health-metrics/src/definitions/recovery.ts` for legacy biomarker alias resolution needed by the shared metric source

## Constraints

- Keep progress-card rendering payload-driven; do not make the image route query private data.
- Prefer the existing generic metric-point selection path over a new metric mapping layer.
- Do not add fallback data paths; run-window biomarker analysis should use the existing generic metric-point window comparison primitive.

## Verification

- Focused query tests for experiment progress/card behavior.
- `pnpm typecheck`
- `pnpm test:diff` for touched files if available/truthful.
Status: completed
Updated: 2026-06-16
Completed: 2026-06-16
