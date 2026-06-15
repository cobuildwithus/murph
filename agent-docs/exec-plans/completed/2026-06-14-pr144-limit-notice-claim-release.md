# PR 144 Limit Notice Claim Release

Goal (incl. success criteria):
- Fix the hosted AI usage limit notice failure cleanup so it only releases a notice claim after this process actually acquired that claim.
- Success means a failed claim attempt cannot clear another sender's already-successful claim, while failed Linq delivery after a successful claim still releases for retry.
- Address ReviewGPT findings: crossing detection must use a true previous-state transition, and notice delivery must reject caller-owned transaction clients.

Constraints/Assumptions:
- Keep `limitNoticeSentAt` as the existing once-per-period dedupe field.
- Do not add new persisted state, queues, schedulers, or delivery abstractions.
- External Linq sends remain best-effort and outside the usage-recording transaction.

Key decisions:
- Track claim ownership with an in-memory boolean around `claimHostedAiUsageLimitNotice` instead of relying on timestamp equality alone.
- Add focused test coverage for claim failure not releasing a non-owned claim.
- Use a CTE to calculate the usage-limit crossing from previous `blocked_at` and `spent_usd_micros` state.
- Require a PrismaClient owner for network-backed notice delivery so no caller can hold a transaction open across Linq I/O.

State:
- Active.

Done:
- ReviewGPT round started against PR 144.
- Local read identified a claim-release ownership edge.
- Patched claim release to require a successfully acquired claim.
- Added focused regression assertion for claim failure not releasing.
- Focused usage-gate-notice Vitest passed: 1 file, 7 tests.
- Fixed stale allowance test expectation for the new `$queryRaw ... RETURNING` spend-increment path.
- Focused hosted usage Vitest passed: 2 files, 50 tests.
- Scoped `pnpm test:diff` passed for the touched hosted-web usage files; `apps/web verify` passed with tests/build/lint/dev smoke.
- ReviewGPT round 1 returned two accepted findings: timestamp-based crossing detection and transaction-client notice delivery.
- Patched crossing detection to use previous row state and patched notice delivery to require a PrismaClient owner.
- Focused hosted usage tests passed after ReviewGPT fixes: 3 files, 74 tests.
- First scoped verification rerun after ReviewGPT fixes failed in Next typecheck because the usage wrapper's notice-client type still allowed a transaction-client intersection; patched it to `PrismaClient`.
- Focused hosted usage tests passed after the type patch: 3 files, 74 tests.
- Scoped `pnpm test:diff` passed after ReviewGPT fixes, including `apps/web verify` tests/build/lint/dev smoke.
- Deep review found an adjacent inline Linq `ai_usage_quota` send-failure claim-release gap; patched side-effect payloads to carry `periodStart` and `claimSentAt`, and release on failed delivery.
- Focused hosted usage + Linq transport tests passed: 4 files, 83 tests.
- Focused Linq dispatch/reset/transport tests passed after wiring the claim timestamp through the inline `ai_usage_quota` response path: 3 files, 79 tests.
- Scoped `pnpm test:diff` passed after the inline Linq claim-release fix, including `apps/web verify` tests/build/typecheck/lint/dev smoke.
- Tightened inline side effects so only a successfully acquired AI usage-limit claim carries release metadata; non-claim denial notices now leave release metadata null.
- Focused hosted usage + Linq tests passed after the optional claim-token change: 6 files, 155 tests.
- Scoped `pnpm test:diff` passed again after the optional claim-token change, including `apps/web verify` tests/build/typecheck/lint/dev smoke.
- `git diff --check` passed and the diff scan found no local identifier leakage.

Now:
- Run local manual audit, commit and push the PR fixes, then rerun ReviewGPT against the updated PR head.

Next:
- Merge after ReviewGPT and CI are clean.

Open questions (UNCONFIRMED if needed):
- Awaiting ReviewGPT rerun on the updated PR head.

Working set (files/ids/commands):
- `apps/web/src/lib/hosted-execution/usage-gate-notice.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts`
- `apps/web/src/lib/hosted-onboarding/webhook-transport.ts`
- `apps/web/test/hosted-execution-usage-gate-notice.test.ts`
- `apps/web/test/hosted-execution-usage-allowance.test.ts`
- `apps/web/test/hosted-execution-usage.test.ts`
- `apps/web/test/hosted-onboarding-linq-dispatch.test.ts`
- `apps/web/test/hosted-onboarding-linq-transport.test.ts`
- `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-linq-usage-reset-e2e.test.ts test/hosted-onboarding-linq-transport.test.ts`
- `pnpm test:diff apps/web/src/lib/hosted-execution/usage-allowance.ts apps/web/src/lib/hosted-execution/usage-gate-notice.ts apps/web/src/lib/hosted-execution/usage.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts apps/web/src/lib/hosted-onboarding/webhook-provider-linq-shared.ts apps/web/src/lib/hosted-onboarding/webhook-transport.ts apps/web/test/hosted-execution-usage-allowance.test.ts apps/web/test/hosted-execution-usage-gate-notice.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-onboarding-linq-transport.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts apps/web/test/hosted-onboarding-linq-usage-reset-e2e.test.ts`
Status: completed
Updated: 2026-06-14
Completed: 2026-06-14
