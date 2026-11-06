# Companion meal fiber reader compatibility

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and protected boundary

Prepare optional nullable per-meal fiber readers before any runtime writer emits
the key. Canonical nutrition remains authoritative; day objects stay unchanged.
The existing schema, full/core parsers and presenter own the change; no new state
or abstraction is needed. Strict old Web/browser/Worker readers reject new keys.

## Scope and sequence

1. Hydrate install, workspace build, Health Commons and Prisma.
2. Trace every reader and prove legacy/null/zero/positive compatibility through
   the strict full/core parsers and both native route presenters.
3. Update the optional contract property, response examples and release order;
   run focused tests, relevant typechecks and complexity:diff.
4. Review and close this reader plan, commit and push a draft reader PR. Implement
   the writer afterward in a separate stacked branch and PR.

Do not start ReviewGPT, mark Ready, merge or deploy. No app implementation,
day totals, generation bump, backfill or forced wake. Synthetic fixtures only.
No changelog entry: nothing is member-visible until a separate app build ships.

## Decisions and risks

- Existing route spreads preserve fiber through `presentCompanionMeals`; no
  production route changes are needed.
- Web promotion does not replace open browser bundles. Require reload/drain and
  compatible Worker/runtime convergence before writer admission to main.
- The runner rebuilds canonical data rather than reading saved Meals. Old
  runners omit fiber; old Workers reject a new runner's fiber output.
- Retain the reader release as the rollback floor after any fiber publication.
- Product UX: backend prerequisite only. Prove unknown versus zero/known values
  and identical day objects; the separate app owns native presentation.

## Verification

- Hydration: install, build, health-commons:generate and apps/web prisma:generate
  each exited 0.
- `pnpm --dir packages/contracts build`: exit 0 after the schema edit.
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/companion-meals.test.ts`: exit 0, 18 tests.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/device-sync-companion-meals-route.test.ts`: exit 0, 40 tests.
- `pnpm --filter @murphai/contracts --filter @murphai/query typecheck`: exit 0.
- `pnpm --dir apps/web typecheck:prepared`: exit 0.
- `pnpm complexity:diff`: exit 0, no new complexity or hotspots.
- `git diff --check`: exit 0. Parent review confirmed the only production change
  is the optional meal property; day schema, producer, generation and route
  implementations are unchanged. Added content contains only synthetic data.
- API compatibility is ready for draft review; deployment convergence and the
  separate native app are outside this task. CI will run on the pushed head.
  ReviewGPT remains explicitly deferred to the owner.
Completed: 2026-11-06
