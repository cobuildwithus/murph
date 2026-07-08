# PR 471 ReviewGPT Round 2

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-2 findings for PR 471 without adding broad repair machinery.
- Success means zeroed Apple HealthKit sleep repairs are scoped to the bad sleep window, provider-filtered stale projections cannot keep old zero summaries fresh, and focused tests cover both cases.

Constraints/Assumptions:
- Keep read-side repair in the wearable sleep query owner.
- Prefer projection invalidation over compatibility shims for stale stored summaries.
- Preserve valid zero stages from other Apple sleep windows.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Replace date/provider invalid-zero detection with invalid Apple window detection.
- Associate zero candidates with invalid windows through resource-window matching or candidate time within the sleep window.
- Bump query projection SQLite version so v14 wearable summaries rebuild under the new resolver.

State:
- Verification complete; ready to commit and push.

Done:
- ReviewGPT round 2 completed with `REVIEW_COMPLETE`.
- Accepted two High findings:
  - provider/date-wide invalid-zero filtering can miss one Apple zeroed sleep or suppress another valid Apple sleep;
  - provider-filtered stored projections can return stale v14 zero summaries without rebuild.
- Replaced provider/date-wide invalid-zero detection with invalid Apple sleep-window detection.
- Added timestamp-window association for sleep stage metrics whose stage resource id does not match the parent sleep session id.
- Added a short-window sleep-selection penalty so a same-day nap does not outrank a full main sleep window.
- Bumped `QUERY_PROJECTION_SQLITE_VERSION` from 14 to 15.
- Added regressions for window-scoped Apple zero repair, WHOOP duplicate-window fallback, and v14 projection rebuild.
- Verification:
  - `pnpm --filter @murphai/query test -- --run packages/query/test/wearables-sleep-session-anchor.test.ts` passed.
  - `pnpm --filter @murphai/query test -- --run packages/query/test/wearable-summary-stored-codec.test.ts` passed.
  - `pnpm --filter @murphai/query test -- --run packages/query/test/query.test.ts -t "rebuilds v14 wearable-summary projections|creates the compact metric point schema"` passed.
  - `pnpm --filter @murphai/importers test -- --run packages/importers/test/device-providers-junction.test.ts` passed.
  - `pnpm --filter @murphai/importers typecheck` passed.
  - `git diff --check` passed.
  - Privacy grep over touched files passed.
  - `pnpm --filter @murphai/query typecheck` still fails on pre-existing Murph Age type/module errors outside the touched files.

Now:
- Commit and push the round-2 follow-up.

Next:
- Rerun the ReviewGPT PR loop against the pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/wearables.ts
- packages/query/src/wearables/selection.ts
- packages/query/test/wearables-sleep-session-anchor.test.ts
- packages/query/src/projection/schema.ts
- packages/query/test/query.test.ts
- packages/query/test/wearable-summary-stored-codec.test.ts
- audit-packages/pr-471-round-2.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
