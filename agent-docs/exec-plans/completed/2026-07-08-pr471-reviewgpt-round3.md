# PR 471 ReviewGPT Round 3

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-3 findings for PR 471 without broad repair machinery.
- Success means stale exact Apple zero rows cannot hide a newly derived generic Apple sleep total, and numeric Junction `-1` sleep-stage inference is Apple HealthKit-specific.

Constraints/Assumptions:
- Keep sleep candidate repair in the query wearable selector.
- Keep provider-specific Junction enum assumptions out of provider-neutral normalization.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Filter invalid zero sleep candidates before selected-window narrowing so valid fallback candidates remain reachable.
- Detect invalid Apple zero windows by any zero total plus awake and no positive stage/efficiency evidence, not first metric order.
- Interpret numeric `-1` / `"-1"` as generic asleep only when the Junction source provider is Apple HealthKit.

State:
- Verification complete; ready to commit and push.

Done:
- ReviewGPT round 3 completed with `REVIEW_COMPLETE`.
- Accepted two High findings:
  - stale exact Apple zero rows can mask the new generic Apple total after re-sync;
  - numeric `stage_type=-1` inference was global instead of Apple HealthKit-specific.
- Query now filters invalid zero sleep candidates before selected-window narrowing, so valid generic totals remain reachable.
- Invalid Apple zero-window detection now keys off any zero total with awake and no positive stage/efficiency evidence, instead of first metric order.
- Junction sleep-stage normalization is provider-neutral again; numeric `-1` / `"-1"` maps to generic asleep only through the Apple HealthKit source-aware sleep-cycle path.
- Added regressions for repaired Apple generic total replacing a legacy exact zero and non-Apple `stage_type=-1` not creating `sleep-total-minutes`.
- Verification:
  - `pnpm --filter @murphai/query test -- --run packages/query/test/wearables-sleep-session-anchor.test.ts` passed.
  - `pnpm --filter @murphai/importers test -- --run packages/importers/test/device-providers-junction.test.ts` passed.
  - `pnpm --filter @murphai/importers typecheck` passed.
  - `pnpm --filter @murphai/query test -- --run packages/query/test/wearable-summary-stored-codec.test.ts` passed.
  - `pnpm --filter @murphai/query test -- --run packages/query/test/query.test.ts -t "rebuilds v14 wearable-summary projections|creates the compact metric point schema"` passed.
  - `git diff --check` passed.
  - Privacy grep over touched files passed.
  - `pnpm --filter @murphai/query typecheck` still fails on pre-existing Murph Age type/module errors outside the touched files.

Now:
- Commit and push the round-3 follow-up.

Next:
- Rerun the ReviewGPT PR loop against the pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/wearables.ts
- packages/query/test/wearables-sleep-session-anchor.test.ts
- packages/importers/src/device-providers/junction-resources.ts
- packages/importers/src/device-providers/junction.ts
- packages/importers/test/device-providers-junction.test.ts
- audit-packages/pr-471-round-3.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
