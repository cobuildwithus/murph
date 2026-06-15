# PR 144 ReviewGPT Round 2

Goal (incl. success criteria):
- Address ReviewGPT round-2 findings on PR 144.
- Success means post-commit usage-limit notice delivery can retry from persisted period state after an idempotent usage callback retry, and Linq `ai_usage_quota` side effects encode whether a releaseable claim token exists.

Constraints/Assumptions:
- Keep the existing `limitNoticeSentAt` atomic claim as the dedupe primitive.
- Do not add queues, schedulers, or new persisted state.
- Keep network delivery outside usage-accounting transactions.

Key decisions:
- Rebuild retryable notice candidates from touched hosted AI usage periods after commit when the period is blocked and no notice claim is recorded.
- Represent Linq usage quota claim ownership as a single optional claim-token object instead of independent nullable fields.

State:
- Active.

Done:
- ReviewGPT round 2 reported a high post-commit idempotency hole and a medium payload invariant issue.
- Added persisted blocked/unclaimed period notice candidate lookup for retryable post-commit notice delivery.
- Updated usage recording to track touched allowance periods and send notices from persisted candidates after commit.
- Replaced loose nullable Linq `ai_usage_quota` claim fields with a single optional `claimToken` object and constructor-level invariant checks.
- Focused hosted usage + Linq tests passed: 5 files, 152 tests.
- Scoped `pnpm test:diff` passed, including `apps/web verify` tests/build/typecheck/lint/dev smoke.

Now:
- Run pre-commit leakage scan, commit, push, and rerun ReviewGPT.

Next:
- Add focused regressions, rerun scoped verification, commit, push, and rerun ReviewGPT.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-execution/usage.ts`
- `apps/web/src/lib/hosted-execution/usage-allowance.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- Matching hosted usage and Linq tests.
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
