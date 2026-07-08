# PR 471 ReviewGPT Round 8

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-8 finding for PR 471.
- Success means stale summary-owned Apple zero stage records and valid cycle-fallback zero stage records cannot merge before invalid-zero ownership is classified.

Constraints/Assumptions:
- Keep canonical vault records append-only.
- Prefer one candidate truth for summary and projection over another downstream special case.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Preserve `dataOrigin.normalizerVersion` in exact metric candidate dedupe identity when present.
- Keep broad candidate ids unchanged; invalid Apple zero repair now tracks record ids internally so same-window summary and cycle-fallback candidates with shared candidate ids do not suppress each other.
- Use a canonical read-model regression with stale-first and cycle-first insertion orders to cover summary selection and metric projection together.

State:
- Implementation and verification complete; ready to commit, push, and rerun ReviewGPT.

Done:
- ReviewGPT round 8 completed with `REVIEW_COMPLETE`.
- Accepted one High finding:
  - exact candidate dedupe can merge stale Apple summary zero rows with valid cycle-fallback zero rows because the dedupe identity omits `dataOrigin.normalizerVersion`.
- Added normalizer-aware exact candidate dedupe identity.
- Switched invalid Apple zero summary suppression from candidate-id sets to record-id sets.
- Converted the cycle-fallback zero regression to a canonical read-model fixture and asserted stale-first/cycle-first order invariance.
- Verification:
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/query.test.ts -t "Apple HealthKit" --reporter=dot` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearables-sleep-session-anchor.test.ts --reporter=dot` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearables-coverage-branches.test.ts -t "dedupe, selection" --reporter=dot` passed.
  - `pnpm --filter @murphai/query test` passed.
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts --reporter=dot` passed.
  - `pnpm --filter @murphai/importers typecheck` passed.
  - `pnpm --filter @murphai/query typecheck` failed on pre-existing Murph Age module/type errors outside this change.
  - `git diff --check` passed.

Now:
- Commit and push the round-8 fix.

Next:
- Run PR preflight and ReviewGPT round 9.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/wearables/dedupe.ts
- packages/query/src/wearables/origin.ts
- packages/query/src/wearables.ts
- packages/query/test/query.test.ts
- audit-packages/pr-471-round-8.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
