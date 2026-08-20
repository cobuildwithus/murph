# Restore PR review disclosures remediation

Status: completed
Created: 2026-08-19
Updated: 2026-08-19

## Goal

- Resolve the accepted preliminary specialist and final ReviewGPT findings on
  PR #2020 without changing the restored disclosure scope.

## Findings

1. The scoped hosted Web README still said catalog updates were not required.
2. The design-proof validator accepted a link to a different catalog tab from
   the catalog source file changed by the PR.
3. The validator accepted visible text instead of an actual link and still
   named the retired `/design?tab=sections` route.
4. Requiring a catalog source-file mutation was a no-op proxy when an existing
   catalog/study route already rendered the changed production state.

All four findings are accepted. The remediation preserves dedicated
catalog/design evidence and CI enforcement by requiring a reviewer-openable
anchored link plus risk-matched evidence and coverage. It requires a
catalog/study update only when no existing route and anchor render the changed
state.

## Tasks

1. [x] Align every current guide and the PR template with the live design and
   screenshot routes.
2. [x] Require an absolute anchored link to a supported live route instead of a
   source-file mutation or visible route text.
3. [x] Add validator regressions for missing anchors, non-links, misleading
   hrefs, relative links, and the retired sections tab; add direct route-anchor
   proof.
4. [x] Prepare one combined remediation head for the required next final
   ReviewGPT round.

## Constraints

- Do not rerun the one-shot preliminary specialist pass.
- Preserve the immutable first-reviewed head already recorded in the PR body.
- Keep screenshots risk-based and retain the current non-UI exemptions.

## Verification

- `node --test scripts/check-frontend-design-proof.test.mjs scripts/check-pr-architecture-summary.test.mjs scripts/check-pr-changelog.test.mjs scripts/check-pr-deployment-concerns.test.mjs` — 32 passed.
- `pnpm test:frontend-design-proof` — 7 passed.
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/biomarker-design-studies.test.tsx` — 11 passed after the worktree's ignored Prisma and Health Commons artifacts were generated.
- `pnpm docs:drift` — passed.
- `git diff --check` and the added-line privacy scan — passed.
- The earlier remediation `pnpm test:diff` run reached the full repo-tools
  shard and failed one workspace-verifier concurrency assertion; the exact
  failing test passed immediately when rerun alone. Exact-head CI owns the
  broad follow-up.
Completed: 2026-08-19
