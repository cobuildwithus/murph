# PR 471 ReviewGPT Round 7

Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-7 finding for PR 471.
- Success means stale Apple HealthKit zero summary candidates are suppressed without hiding valid same-window cycle fallback zero stage facts such as REM=0.

Constraints/Assumptions:
- Keep read-side repair for already-imported bad Apple zero summary rows.
- Do not add provider-specific broad special cases when candidate ownership can solve the issue.
- Keep ReviewGPT artifacts under `audit-packages/` uncommitted.

Key decisions:
- Invalid Apple zero repair now tracks exact metric candidate ids instead of treating every zero inside an invalid window as bad.
- Summary-owned rows are identified by same sleep summary resource or `junction-sleep-stage-summary.v1`; `junction-sleep-stage-cycle-fallback.v1` rows are explicitly preserved.
- Legacy unversioned stale rows are only suppressed as companions when they share the same provider/source origin and `recordedAt` batch as the invalid zero total summary candidate.

State:
- Implementation and verification complete; ready to commit, push, and rerun ReviewGPT.

Done:
- ReviewGPT round 7 completed with `REVIEW_COMPLETE`.
- Accepted one High finding:
  - window-wide invalid-zero suppression can hide valid same-window zero sleep stage facts from Apple cycle fallback records.
- Replaced window-wide invalid-zero suppression with candidate-id suppression evidence.
- Added a runtime projection regression proving valid Apple cycle fallback REM=0 remains visible while stale summary zero rows are suppressed.
- Verification:
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/query.test.ts -t "Apple HealthKit" --reporter=dot` passed.
  - `pnpm --dir packages/query exec vitest run --config vitest.config.ts --no-coverage test/wearables-sleep-session-anchor.test.ts --reporter=dot` passed.
  - `pnpm --filter @murphai/query test` passed.
  - `pnpm --dir packages/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers-junction.test.ts --reporter=dot` passed.
  - `pnpm --filter @murphai/importers typecheck` passed.
  - `pnpm --filter @murphai/query typecheck` failed on pre-existing Murph Age module/type errors outside this change.
  - `git diff --check` passed.

Now:
- Commit and push the round-7 fix.

Next:
- Run PR preflight and ReviewGPT round 8.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/query/src/wearables.ts
- packages/query/test/query.test.ts
- audit-packages/pr-471-round-7.md (local artifact, uncommitted)
Status: completed
Updated: 2026-07-08
Completed: 2026-07-08
