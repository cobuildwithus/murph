# Biomarkers Dashboard Route Group

## Goal

Reconcile `/biomarkers` with the dashboard route group so the route family inherits the shared `(dashboard)` layout instead of carrying a duplicate dashboard wrapper outside the group.

Success criteria:
- `/biomarkers` and `/biomarkers/[biomarkerId]` keep the same public URLs.
- Biomarker pages inherit the shared dashboard layout from `app/(dashboard)/layout.tsx`.
- The duplicate biomarkers-specific dashboard wrapper is removed.
- Focused route/layout coverage and typecheck pass, or any unrelated blocker is documented.

## Scope

Owned files:
- `apps/web/app/(dashboard)/biomarkers/**`
- Directly coupled focused route/layout tests if the move changes test expectations.

Out of scope:
- Dashboard visual redesign.
- Auth/session behavior changes beyond preserving the existing `HostedPrivyBoundary` inheritance.
- Health Commons projection/content changes.

## State

Created 2026-05-02. Route family moved under `app/(dashboard)/biomarkers`; focused tests were updated to the new filesystem path.

Verification so far:
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/biomarker-layout.test.ts apps/web/test/biomarker-browse-card.test.ts apps/web/test/health-commons-biomarker-detail-page.test.ts apps/web/test/health-commons-route-bundle-boundary.test.ts` passed: 4 files, 26 tests.
- `pnpm --dir apps/web typecheck` passed.
- `pnpm test:diff ...` reached `apps/web verify` and failed on unrelated current app issues: hosted legal consent card expectation, root page hero typography expectation, and dirty `apps/web/src/lib/health-commons/biomarker-bindings.ts` build typing.
