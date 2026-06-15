# PR 144 ReviewGPT Round 3

Goal (incl. success criteria):
- Address ReviewGPT round-3 findings on PR 144.
- Success means claims cannot send stale usage-limit notices after unblocking, post-commit notice lookup/send remains best-effort after accounting commits, and accounting no longer returns unused notice text.

Constraints/Assumptions:
- Keep `limitNoticeSentAt` as the only dedupe claim field.
- Do not add new persisted state or delivery infrastructure.
- Preserve DB-only accounting transactions and network sends after commit.

Key decisions:
- Add `blockedAt != null` to the atomic notice claim predicate.
- Catch/log the entire post-commit proactive notice phase and return recorded IDs once accounting commits.
- Make the transaction-owned accounting return only the crossed period reference.

State:
- Active.

Done:
- ReviewGPT round 3 reported stale claim race, non-best-effort candidate lookup, and unused notice text construction.
- Added `blockedAt != null` to the atomic usage-limit notice claim predicate.
- Made the post-commit proactive notice lookup/send phase best-effort after usage accounting commits.
- Simplified `accountHostedAiUsageForAllowanceTx` to return only the crossed period reference; persisted candidate lookup is the single proactive notice text owner.
- Focused hosted usage tests passed: 3 files, 79 tests.
- Focused hosted usage + Linq tests passed: 5 files, 159 tests.
- Scoped `pnpm test:diff` passed, including `apps/web verify` tests/build/typecheck/lint/dev smoke.

Now:
- Run pre-commit leakage/static scans, commit, push, and rerun ReviewGPT.

Next:
- Update tests, rerun verification, commit, push, and rerun ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/web/test/hosted-execution-usage.test.ts`
- `apps/web/test/hosted-execution-usage-gate-notice.test.ts`
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
