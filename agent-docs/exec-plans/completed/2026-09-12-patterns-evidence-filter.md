# Filter sparse and inactive Patterns results

## Outcome

The Patterns page shows comparisons supported by at least two independent cases and hides activities without a session in the report's last three calendar months. Existing query grades and canonical history remain owned by their current sources.

## Evidence and approach

The query supports one-case grade E observations. The page currently filters only stages, while the report spans 120 days. Add the latest observed date to the existing factor projection and preserve it through Browser Vault parsing. Filter at the existing page selector before pagination, for both layouts. Legacy reports use matched exposure dates as conservative recency evidence.

## Product UX

- Entry: open Patterns with sparse, inactive, mixed, or established history.
- Reaches: mobile cards and desktop matrix; per-outcome sparse comparisons disappear, eligible neutral rows remain, and an entirely filtered report uses the existing learning state.
- Proof: focused query/parser and page tests, synthetic design study and browser replay, relevant typechecks, diff review and complexity check.
- Done when: two-case boundary, calendar-month cutoff, recent unmatched sessions, and legacy reports are covered without changing evidence grades or deleting history.

## Progress

- Implemented optional latest-observed metadata in the query and Browser Vault parser, with legacy fallback in the page selector.
- Query: `pnpm --dir packages/query test test/personal-patterns.test.ts` passed (43 tests); `pnpm --dir packages/query typecheck` passed.
- Web: `pnpm --dir apps/web test:prepared test/browser-vault-dashboard-pages.test.tsx` passed (34 tests); `pnpm --dir apps/web test:prepared test/changelog-page.test.tsx` passed (10 tests); `pnpm --dir apps/web typecheck` passed.
- Initial web test execution preceded generated Health Commons inputs; the normal generation completed and the same test then passed. No repository workaround was needed.
- Focused web ESLint, `pnpm complexity:diff`, and `git diff --check` passed. Candidate review found no remaining correctness, privacy, or ownership issue.
- Browser: `VIEWPORT_OVERFLOW_PORT=3297 NEXT_DIST_DIR_SUFFIX=patterns-evidence-filter DESIGN_PROOF_OUTPUT_DIR=../../.artifacts/review-gpt/patterns-evidence-filter pnpm --dir apps/web exec playwright test e2e/patterns-mobile.spec.ts --config playwright.config.ts --project chromium` passed. Replayed cards, drawers, neutral and insufficient states, pagination, and 320/390/640/1440 widths using synthetic production components.
- Inspected the synthetic phone overview and desktop screenshots at original resolution. Repository design surface: `/design?tab=components#personal-patterns-component`. Captures remain ignored and local.
- Product UX: Ready. Sparse comparisons and inactive activities disappear before pagination; the learning state and eligible results retain their existing behavior.
- Changelog: updated with `patterns-evidence-filter`.
- Scope: local implementation and scoped commit. No PR, CI, external ReviewGPT, merge, or deployment performed. Those delivery gates remain for a future PR.
Status: completed
Updated: 2026-09-12
Completed: 2026-09-12
