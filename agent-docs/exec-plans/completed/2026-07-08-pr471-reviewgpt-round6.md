# PR 471 ReviewGPT Round 6

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-6 finding for PR 471 without changing public wearable summary provenance.
- Success means invalid Apple HealthKit zero sleep observations are excluded from decision-grade metric points as well as wearable sleep summaries.

Constraints/Assumptions:
- Keep invalid Apple zero rows non-selectable and out of public selected evidence.
- Reuse existing metric-point suppression evidence instead of adding a parallel projection filter.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Reuse the existing metric projection suppression path instead of adding a second raw-point filter.
- Build invalid Apple HealthKit zero sleep suppression evidence from the same wearable dataset used for summary selection, keyed by canonical metric point ids.
- Keep invalid Apple zero rows out of public selected evidence; they are internal suppression evidence only.

State:
- Implementation and verification complete; ready to commit, push, and rerun ReviewGPT.

Done:
- ReviewGPT round 6 completed with `REVIEW_COMPLETE`.
- Accepted one High finding:
  - invalid Apple zero sleep observations are filtered from wearable summaries but can still leak into metric-point projections.
- Added metric suppression evidence for invalid Apple HealthKit zero sleep total/efficiency/stage metrics.
- Added projection regressions for invalid Apple zero sleep rows with and without a valid WHOOP sleep candidate.
- Verification:
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/query.test.ts -t "listMetricPointsRuntime suppresses invalid Apple HealthKit zero" --reporter=dot` passed.
  - `pnpm --filter @murphai/query test` passed.
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts --reporter=dot` passed.
  - `pnpm --filter @murphai/importers typecheck` passed.
  - `pnpm --filter @murphai/query typecheck` failed on pre-existing Murph Age module/type errors outside this change.
  - `git diff --check` passed.

Now:
- Commit and push the round-6 fix.

Next:
- Run PR preflight and ReviewGPT round 7.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/wearables.ts
- packages/query/src/metrics/projection.ts
- packages/query/test/*
- audit-packages/pr-471-round-6.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
