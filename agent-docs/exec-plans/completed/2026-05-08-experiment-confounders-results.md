# Experiment Confounders In Results

## Goal

Surface logged experiment session context in the browser-vault experiment results view without making the UI parse vault internals.

Success criteria:

- Browser-vault experiment results expose typed session context derived from linked experiment events.
- Session-level confounders, symptoms, and notes appear in the private run results view when present.
- The projection stays read-only and does not introduce new persisted state.
- Empty runs keep the current results UI shape.

## Constraints And Assumptions

- Confounders already exist on session events in the vault/browser replica.
- `@murphai/query/browser` is the right owner for browser-safe run projections.
- `apps/web` should consume a typed projection only.
- Keep this separate from the active experiment CLI typed-surface plan.
- Preserve unrelated dirty working-tree edits.

## Implementation Steps

1. Add a compact browser-vault experiment context projection in `packages/query/src/browser-replica/experiments.ts`.
2. Export the new projection type through the existing browser entrypoints.
3. Map the projection into `ExperimentRunProjection`.
4. Render context in the results tab as a concise interpretation aid, adjacent to result/conclusion content.
5. Add focused query and web rendering tests.
6. Run focused verification, then required audits.

## Verification

- Passed: focused query selector/replica tests:
  - `pnpm --dir packages/query exec vitest run test/browser-vault-experiment-results.test.ts test/browser-vault-replica.test.ts --config vitest.config.ts --no-coverage`
- Passed: focused web render test:
  - `pnpm --dir apps/web exec vitest run test/experiment-detail-private-run.test.tsx --config vitest.workspace.ts --no-coverage`
- Passed: `pnpm --dir packages/query test:coverage`
- Passed: `pnpm --dir apps/web typecheck`
- Passed: `git diff --check` for the scoped files.
- Blocked/unrelated: `pnpm typecheck` fails in dirty `apps/cloudflare/src/user-runner.ts`.
- Blocked/unrelated: `pnpm test:diff <scoped paths>` fails in CLI document/meal tests.
- Blocked/unrelated: full `pnpm --dir apps/web test` fails in hosted billing, biomarker, and hosted account settings tests.
- Not run: live browser screenshot pass; focused server-rendered Results tab coverage passed and frontend review had no findings.

## Open Questions

- UNCONFIRMED: Whether outcome cards will get a separate public contribution projection later. This plan only covers the private browser-vault results view.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
