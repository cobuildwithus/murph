# Health Commons Experiment Projections

## Goal

Move public experiment route rendering off the large route bundle/full `ExperimentProtocol` model by adding generated, route-scoped projections for the shell, protocol tab, and public results tab.

## Success Criteria

- `packages/health-commons` generates narrow experiment shell, protocol-tab, and results-public artifacts.
- `apps/web` experiment layout, protocol page, and results page consume those projections instead of resolving the full route bundle model.
- Existing route bundle remains the canonical dependency-closure primitive.
- Focused tests prove alias lookup, size/data minimization, and app import boundaries.
- Verification and required completion reviews run before handoff.

## Constraints

- Preserve unrelated dirty-tree changes and active ledger rows.
- Do not move generated route bundles out of their canonical role.
- Do not expose local personal identifiers in files, commits, logs, or handoff.
- Keep UI behavior stable except for the intentional static-first public shell/private overlay boundary.

## Working Set

- `packages/health-commons/src/web-artifacts.ts`
- `packages/health-commons/src/build.ts`
- `packages/health-commons/src/index.ts`
- `packages/health-commons/src/runtime.ts`
- `packages/health-commons/test/**`
- `apps/web/scripts/check-health-commons-traces.ts`
- `apps/web/app/(dashboard)/experiments/[experimentId]/**`
- `apps/web/app/(dashboard)/experiments/page.tsx`
- `apps/web/src/components/experiments/experiment-detail/**`
- `apps/web/src/lib/browser-vault/experiment-run.ts`
- `apps/web/src/lib/health-commons/experiment-browse.ts`
- `apps/web/src/lib/health-commons/experiment-images.ts`
- `apps/web/src/lib/health-commons/experiment-projections.ts`
- `apps/web/test/**`

## Verification Plan

- Health Commons focused tests for generated projection shape and size guards.
- Hosted web focused tests for experiment route projection imports and client-boundary behavior.
- Scoped typecheck/test commands where repo-wide checks are already red from unrelated active rows.

## State

- Implemented shell, protocol-tab, research-tab, and results-public generated experiment projections.
- Moved experiment detail route layout/page/results onto narrow projections; BrowserVault private reads are scoped to the Results tab client.
- Split browse/static-param reads onto compact generated browse artifacts.
- Removed the legacy full-detail experiment route client and package-root export of generator internals.
- Added a post-build Next trace guard for `packages/health-commons/generated/catalog.json` globally and generated route bundles in experiment detail traces.
- Verification green: Health Commons typecheck/test/generate:check, apps/web typecheck/lint/build, focused experiment projection tests, trace guard, artifact size check.
- Repo-wide apps/web test remains red from unrelated active rows/content expectations; no focused projection failures remain.
Status: completed
Updated: 2026-04-29
Completed: 2026-04-29
