# PR 471 ReviewGPT Round 1

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-1 findings for PR 471 without broadening the Junction sleep architecture.
- Success means near-identical duplicate HealthKit windows cannot anchor zeroed Apple sleep over WHOOP, and cycle-derived total sleep includes all non-awake intervals while preserving explicit stage semantics.

Constraints/Assumptions:
- Keep fixes scoped to Junction importer/query sleep owners and focused tests.
- Do not infer deep, REM, or light from generic HealthKit `Asleep` intervals.
- Preserve valid Apple HealthKit windows and awake minutes.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Accept both round-1 findings as real correctness gaps.
- Use existing session-minute tolerance for duplicate sleep-window time deltas.
- Make sleep-cycle fallback total own every non-awake interval while stage aggregates remain detailed-stage only.

State:
- Complete; ready for scoped commit.

Done:
- ReviewGPT round 1 completed with `REVIEW_COMPLETE`.
- Triage accepted two High findings:
  - exact duplicate-window matching missed provider timestamp precision differences;
  - mixed generic/detailed sleep-cycle intervals emitted partial direct total sleep.
- Fixed duplicate sleep-window matching to use session-minute timestamp and duration tolerance.
- Fixed cycle-derived total sleep to include all non-awake intervals in windows that contain generic asleep intervals.
- Added focused importer and query regressions for both findings.
- Verified focused importer/query tests, stored projection test, importer typecheck, and `git diff --check`.

Now:
- Commit and push round-1 fixes.

Next:
- Rerun ReviewGPT on the new PR head.

Open questions (UNCONFIRMED if needed):
- `pnpm --filter @murphai/query typecheck` remains blocked by unrelated Murph Age type/module errors; after the fix, it reports no task-owned `wearables.ts` errors.

Working set (files/ids/commands):
- packages/query/src/wearables.ts
- packages/query/test/wearables-sleep-session-anchor.test.ts
- packages/importers/src/device-providers/junction.ts
- packages/importers/test/device-providers-junction.test.ts
- audit-packages/pr-471-round-1.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
