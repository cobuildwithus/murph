# Land the downloaded hosted AI usage billing follow-up patch in the narrow hosted metering and pending-usage safety slice

Status: completed
Created: 2026-04-22
Updated: 2026-04-22

## Goal

- Land the downloaded hosted AI usage billing follow-up patch without widening beyond the missing hosted metering retry/idempotency behavior and the directly related pending-usage path safety seam.

## Success criteria

- Hosted AI usage rows track Stripe metering attempts, last-attempt timestamps, and next-attempt due times.
- Retryable Stripe meter failures back off instead of hot-looping, and the drain only picks rows whose retry window is due.
- Hosted AI usage import stays idempotent for exact duplicates but fails closed on conflicting duplicate `usageId` records.
- Pending assistant usage file paths are encoded so path-like usage ids cannot escape the pending-usage directory.
- Focused verification plus the repo-required completion workflow complete, or any unrelated blocker is documented precisely.

## Scope

- In scope:
- `apps/web/prisma/{schema.prisma,migrations/**}`
- `apps/web/src/lib/hosted-execution/{usage,stripe-metering}.ts`
- focused hosted metering and hosted usage tests under `apps/web/test/**`
- `packages/runtime-state/src/assistant-usage.ts`
- focused pending-usage path coverage under `packages/runtime-state/test/**`
- Out of scope:
- unrelated hosted onboarding pricing/env/docs work already landed by the prior patch
- unrelated active `apps/web`, assistant-engine, Health Commons, or hosted-runtime work already in the tree

## Constraints

- Technical constraints:
- Treat the downloaded patch as behavioral intent because it was generated against an older snapshot with the earlier billing patch already applied.
- Preserve unrelated dirty-tree edits and do not widen into neighboring hosted billing or experiment-detail work.
- Product/process constraints:
- This is a billing/retry boundary, so keep failure handling explicit and verified.
- Use `scripts/finish-task` for the scoped commit because this lane is plan-bearing.

## Risks and mitigations

1. Risk: Replaying stale patch hunks could overwrite current hosted billing code or tests.
   Mitigation: Merge only the still-missing behavior into current HEAD and verify with focused tests plus repo-required checks.
2. Risk: Retry-state updates can become non-idempotent or race with concurrent drains.
   Mitigation: Keep row updates guarded on pending status, store attempt metadata explicitly, and cover the state transitions in tests.
3. Risk: Usage-id filename handling can regress existing pending usage cleanup behavior.
   Mitigation: Encode new filenames and remove legacy safe filenames opportunistically with focused path tests.

## Tasks

1. Merge the artifact’s missing hosted metering retry/idempotency changes into the current `apps/web` files.
2. Land the pending assistant usage filename-safety change in `packages/runtime-state` with focused regression coverage.
3. Run focused verification during iteration, then the repo-required verification lane and required audits.
4. Finish with a scoped commit and document any unrelated blockers separately.

## Decisions

- Keep the change scoped to the artifact’s follow-up concerns only: retry scheduling, immutable-ledger import safety, and pending-usage path encoding.

## Verification

- Commands to run:
- focused `vitest` for hosted metering/usage and pending-usage path coverage during iteration
- `pnpm verify:acceptance`
- any narrower reruns required after audit-driven fixes
- Expected outcomes:
- The hosted usage follow-up slice passes, or any unrelated blocker is called out with the failing command and reason.
- Actual outcomes:
- Passed focused hosted-web coverage: `pnpm exec vitest run --config apps/web/vitest.config.ts apps/web/test/hosted-onboarding-privacy-foundation-migration.test.ts apps/web/test/hosted-execution-usage.test.ts apps/web/test/hosted-execution-stripe-metering.test.ts --no-coverage`
- Passed focused runtime-state coverage: `pnpm --dir packages/runtime-state exec vitest run test/assistant-usage.test.ts test/assistant-usage-path.test.ts --config vitest.config.ts --no-coverage`
- Passed `pnpm typecheck`
- Passed `pnpm test:smoke`
- Scoped `bash scripts/workspace-verify.sh test:diff ...` still fails only on the unrelated pre-existing `apps/web/test/experiment-header.test.ts` expectation from the separate experiments-header lane.
- Direct proof confirmed encoded pending-usage filenames stay inside the pending directory and do not retain slash or backslash characters.
Completed: 2026-04-22
