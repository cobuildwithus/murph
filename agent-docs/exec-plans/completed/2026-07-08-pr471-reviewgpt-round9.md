# PR 471 ReviewGPT Round 9

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-9 complexity-collapse finding for PR 471.
- Success means legacy Apple HealthKit zero-summary validity is classified once at wearable candidate construction, with valid candidates exposed to summaries/projection and suppressed record IDs carried for raw metric-point suppression.

Constraints/Assumptions:
- Keep importer fail-closed for new bad Apple zero summaries.
- Keep raw canonical vault records append-only; read-side sanitizer is for legacy rows only.
- Preserve valid WHOOP/direct sleep selection, Apple generic asleep totals, and valid cycle-fallback zero stages.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- The legacy Apple HealthKit zero-sleep summary repair is owned by `collectWearableDataset`.
- Downstream sleep summaries resolve only sanitized metric candidates and still prefer direct device evidence over Apple HealthKit mirroring for same-window metrics.
- Metric projection consumes `dataset.metricSuppressionEvidence` instead of reclassifying invalid rows.

State:
- Implementation complete; verification complete except for the pre-existing `@murphai/query` Murph Age typecheck failure.

Done:
- ReviewGPT round 9 completed with `REVIEW_COMPLETE`.
- Accepted one complexity-collapse finding:
  - invalid Apple zero summary is currently reclassified in summary selection and metric projection instead of owned once.
- Added dataset-level metric suppression evidence for raw Apple zero rows.
- Moved sleep association helpers to `packages/query/src/wearables/sleep-association.ts`.
- Deleted duplicate invalid-zero discovery from `packages/query/src/wearables.ts`.
- Updated metric projection to consume dataset suppression evidence directly.
- Verification:
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/query.test.ts -t "Apple HealthKit" --reporter=dot` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearable-summary-stored-codec.test.ts --reporter=dot` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearables-sleep-session-anchor.test.ts --reporter=dot` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearables-coverage-branches.test.ts --reporter=dot` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/query.test.ts --reporter=dot` passed.
  - `pnpm --filter @murphai/query test` passed.
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts --reporter=dot` passed.
  - `pnpm --filter @murphai/importers typecheck` passed.
  - `git diff --check` passed.
  - Privacy scan of touched files for local identifiers passed.
- `pnpm --filter @murphai/query typecheck` remains blocked by unrelated Murph Age module/type errors.

Now:
- Commit, push, and rerun ReviewGPT.

Next:
- Resolve any accepted ReviewGPT follow-up findings.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/wearables/candidates.ts
- packages/query/src/wearables/types.ts
- packages/query/src/wearables/sleep-association.ts
- packages/query/src/wearables.ts
- packages/query/src/metrics/projection.ts
- packages/query/src/projection/wearable-summary-compose.ts
- packages/query/src/projection/wearable-summary-projector.ts
- packages/query/test/wearable-summary-stored-codec.test.ts
- packages/query/test/wearables-source-health-final.test.ts
- audit-packages/pr-471-round-9.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
