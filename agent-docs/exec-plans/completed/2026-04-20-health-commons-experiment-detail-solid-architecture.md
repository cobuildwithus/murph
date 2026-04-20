# Health Commons experiment-detail solid architecture landing

Status: completed
Created: 2026-04-20
Updated: 2026-04-20

## Goal

- Land the supplied Health Commons experiment-detail refactor so the page cleanly composes public protocol data from Health Commons with private run state from the browser-vault snapshot.

## Success criteria

- The server page resolves only a typed public `ExperimentProtocol`.
- The client overlays browser-vault run state through a narrow `ExperimentRunProjection`.
- `Experiment` remains the composed UI model instead of duplicating public protocol truth into private run data.
- The results tab shows honest empty/error/loading states when no private run or no exported biomarker comparison is available.
- Focused `apps/web` tests cover the new page contract and the private-run projection/composition path.

## Scope

- `apps/web/app/(dashboard)/experiments/[experimentId]/**`
- `apps/web/src/components/experiments/experiment-detail/**`
- `apps/web/src/lib/browser-vault/experiment-run.ts`
- `apps/web/src/lib/experiments/experiment-detail.ts`
- `apps/web/src/lib/health-commons/experiment-detail.ts`
- `apps/web/src/types/experiments.ts`
- focused `apps/web/test/**`
- `apps/web/README.md`

## Constraints

- Preserve unrelated dirty-tree edits.
- Keep the change inside the existing hosted-web / Health Commons seams.
- Do not widen this into a new dashboard data model, protocol-library redesign, or workspace-resolution change unless the current repo state forces a minimal compatibility fix.
- Do not commit private browser-vault protocol prose or commons revisions into run state.

## Verification

- passed: `pnpm typecheck`
- passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/health-commons-experiment-detail-page.test.ts test/experiment-detail-private-run.test.ts --no-coverage`
- passed with pre-existing warnings only: `pnpm --dir apps/web lint`
- passed: `git diff --check -- apps/web/app/\(dashboard\)/experiments/\[experimentId\]/page.tsx apps/web/app/\(dashboard\)/experiments/\[experimentId\]/experiment-detail-client.tsx apps/web/src/components/experiments/experiment-detail/experiment-header.tsx apps/web/src/components/experiments/experiment-detail/results-tab.tsx apps/web/src/lib/browser-vault/experiment-run.ts apps/web/src/lib/experiments/experiment-detail.ts apps/web/src/lib/health-commons/experiment-detail.ts apps/web/src/types/experiments.ts apps/web/test/health-commons-experiment-detail-page.test.ts apps/web/test/experiment-detail-private-run.test.ts apps/web/README.md agent-docs/exec-plans/active/2026-04-20-health-commons-experiment-detail-solid-architecture.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- passed: `bash scripts/workspace-verify.sh test:diff 'apps/web/app/(dashboard)/experiments/[experimentId]' apps/web/src/components/experiments/experiment-detail apps/web/src/lib/browser-vault/experiment-run.ts apps/web/src/lib/experiments/experiment-detail.ts apps/web/src/lib/health-commons/experiment-detail.ts apps/web/src/types/experiments.ts apps/web/test/health-commons-experiment-detail-page.test.ts apps/web/test/experiment-detail-private-run.test.ts apps/web/README.md`
- required audit review completed: `coverage-write`
- required audit review completed: `frontend-review`
- required audit review completed: `task-finish-review`

## Notes

- The supplied patch no longer applies cleanly because `apps/web/src/lib/health-commons/experiment-detail.ts` has drifted, but its intended final shape is still narrow and matches the current generated-catalog / browser-vault seams already in the repo.
- Follow-up fixes from the review passes tightened the greenfield seam further: private-run matching is now stable-identifier-only, baseline progress no longer pretends the active protocol has started, and paused/stopped browser-vault states remain explicit instead of collapsing into a happy-path run.
Completed: 2026-04-20
