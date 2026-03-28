# Query/Web Overview Boundary Cleanup

## Goal

Move reusable overview selectors and path-safe search materialization into `@murph/query` so `packages/web` becomes a thinner vault-selection and transport adapter without changing behavior or leaking raw vault paths.

## Scope

- `packages/query/src/**` overview selector/search helper additions plus stable package exports
- `packages/web/src/lib/overview.ts` adapter cleanup
- Focused `packages/query` and `packages/web` tests for overview/search behavior

## Constraints

- Preserve the existing overview payload shape consumed by `packages/web`.
- Keep the web-layer no-path-leak behavior as a hard guardrail.
- Avoid framework churn and keep `packages/web` on stable package-surface imports instead of query subpath coupling.
- Preserve adjacent dirty-tree edits and avoid unrelated UI or device-sync changes.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused tests while iterating: `packages/query` overview/search coverage and `packages/web/test/overview.test.ts`

## Notes

- Extract the clearly pure selectors first (`buildMetrics`, `buildWeeklyStats`), then fold related summaries/search shaping into the query package only where they remain reusable and UI-agnostic.
Status: completed
Updated: 2026-03-28
Completed: 2026-03-28
