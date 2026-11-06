# Companion meal fiber projection writer

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and boundary

After the separate reader release, publish per-meal fiber from canonical
nutrition.totals.fiberGrams. Missing fiber is null and zero remains zero. Keep
the existing nutrients array, day totals, generation and publication lifecycle.
The query projection builder owns this derivation; no new stored truth is added.

## Scope and sequence

1. Stack codex/meals-fiber-writer on the pushed reader head from PR #4664.
2. Add the existing numberOrNull helper call to each meal and exercise known,
   zero and missing totals through full/core strict round-trips and exact days.
3. Run focused query/Web suites, relevant typechecks and complexity:diff; review
   the diff, close this plan, commit, push and open a second draft PR.

Keep both PRs Draft. The owner handles ReviewGPT, Ready, merge and deployment.
No generation bump, backfill, forced wake, day fiber or app implementation.

## Product and release proof

- Product UX: backend prerequisite for a separate app build. Known, zero and
  unknown meal values remain distinct. Day completeness is the app's decision.
- Reader inventory, rollout order and rollback floor remain in ios-meals.md and
  reader PR #4664. Compatible Web, browser sessions and Worker/runtime deployment
  must converge before this writer reaches main.
- Existing runtime freshness detects source changes or maximum age; ordinary
  later publication updates retained replicas without a generation bump.
- No changelog entry: nothing is member-visible until the separate app ships.

## Verification

- `pnpm --dir packages/query build`: exit 0.
- `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/companion-meals.test.ts`: exit 0, 19 tests.
- `pnpm exec vitest run --config apps/web/vitest.config.ts --no-coverage apps/web/test/device-sync-companion-meals-route.test.ts`: exit 0, 40 tests.
- `pnpm --dir packages/query typecheck`: exit 0.
- `pnpm --dir apps/web typecheck:prepared`: exit 0.
- `pnpm complexity:diff --base codex/meals-fiber-reader`: exit 0. The builder's
  existing optional chaining adds one branch (19 to 20), with no hotspot above
  the threshold. Reusing numberOrNull is the smallest maintainable change.
- `git diff --check`: exit 0.
- Parent review: one production assignment, unchanged nutrients/day totals,
  strict full/core round-trips for builder output, and synthetic fixtures only.
  No requirement deviations; native presentation remains the separate app's work.
- Required CI proof rejects Draft PRs before execution. Keep Draft as requested;
  the owner controls Ready, ReviewGPT and the remaining production gates.
Completed: 2026-11-06
