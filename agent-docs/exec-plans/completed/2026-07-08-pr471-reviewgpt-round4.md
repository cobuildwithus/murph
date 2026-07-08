# PR 471 ReviewGPT Round 4

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-4 findings for PR 471 without broad repair machinery.
- Success means stale Apple zero totals cannot suppress valid stage-derived totals, and Apple HealthKit `stage_type=-1` stays inside source-aware parent/direct-interval gates.

Constraints/Assumptions:
- Keep read-side repair scoped to invalid Apple sleep summary zeros.
- Keep parentless direct Junction sleep stage fragments raw-only unless a stable parent/session identity exists.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Classify Apple impossible-zero sleep windows from zero total + positive awake + real duration gap, independent of positive replacement stage evidence.
- Keep Junction sleep-cycle parent/direct-interval checks source-aware anywhere `stage_type=-1` could be interpreted as Apple generic asleep.

State:
- Verification complete; ready to commit and push.

Done:
- ReviewGPT round 4 completed with `REVIEW_COMPLETE`.
- Accepted two High findings:
  - positive Apple stage evidence can currently rescue a stale impossible Apple zero summary;
  - Apple HealthKit `stage_type=-1` is source-aware in interval parsing but source-blind in parent/direct-interval gates.
- Query invalid-zero detection no longer lets positive replacement stage evidence validate a stale Apple zero total.
- Junction sleep-cycle parent identity and nested direct-interval splitting now use the source-aware sleep stage classifier.
- Added regressions for:
  - stale Apple exact zero plus positive Apple stage facts deriving total sleep from stages;
  - parentless Apple `stage_type=-1` direct fragments staying raw-only;
  - parented Apple generic asleep envelope still emitting `sleep-total-minutes`.
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
- Commit and push the round-4 follow-up.

Next:
- Rerun the ReviewGPT PR loop against the pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/wearables.ts
- packages/query/test/wearables-sleep-session-anchor.test.ts
- packages/importers/src/device-providers/junction.ts
- packages/importers/test/device-providers-junction.test.ts
- audit-packages/pr-471-round-4.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
