# PR 144 ReviewGPT Round 4

Goal (incl. success criteria):
- Address ReviewGPT round-4 findings on PR 144.
- Success means each committed usage record flushes any proactive notice attempt before the next record can fail, and accounting no longer carries a redundant crossing signal.

Constraints/Assumptions:
- Keep notice eligibility owned by persisted period state via `listHostedAiUsageLimitNoticeCandidates`.
- Keep notice delivery best-effort and after each record transaction commits.
- Do not add new persisted state or delivery infrastructure.

Key decisions:
- Add a per-record post-commit callback for the notice wrapper.
- Make allowance spend increment a DB-only mutation and collect touched periods from the usage row after accounting.

State:
- Active.

Done:
- ReviewGPT round 4 reported the multi-record flush edge and redundant crossing signal.
- Refactored the notice wrapper to flush proactive notice attempts after each committed usage-record transaction.
- Removed the redundant accounting crossing return and simplified the allowance spend increment to a DB-only update.
- Added regression coverage for a later batch record failing after an earlier notice-triggering record commits.
- Focused hosted usage tests passed: 3 files, 78 tests.
- Scoped `pnpm test:diff` passed, including `apps/web verify` tests/build/typecheck/lint/dev smoke.

Now:
- Run pre-commit scans, commit, push, and rerun ReviewGPT.

Next:
- Update tests, rerun verification, commit, push, and rerun ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/web/test/hosted-execution-usage.test.ts`
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
