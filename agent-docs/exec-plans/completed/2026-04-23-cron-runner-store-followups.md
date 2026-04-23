# Land targeted cron, hosted-run store, and runner lifecycle cleanup follow-ups

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Land the requested follow-up cleanups across assistant cron ownership boundaries, hosted-run cursor mutation helpers, hosted-ingress store naming, and Cloudflare runner run-drain lifecycle orchestration without changing the intended runtime behavior.

## Success criteria

- Assistant cron splits food auto-log creation behind a dedicated adapter/discriminated input so generic assistant-cron creation does not carry the hidden `foodAutoLog` mode.
- Assistant cron mutators share one resolved-job mutation path or source adapter so local and canonical mutations stop duplicating branching and runtime-state updates.
- Hosted-run store centralizes locked cursor loading, cursor update field resolution, and repeated commit/finalize failure branches without changing wire behavior.
- Hosted-ingress/store helper names reserve `*Tx` for transaction-only helpers and use neutral names for store-client helpers.
- Cloudflare runner run-drain prepare/finalize flows share one lifecycle helper for the common orchestration skeleton while preserving the existing policy differences.
- Focused verification and required audit passes complete, or any unrelated pre-existing failures are documented.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant/cron.ts`
- Directly coupled assistant-engine cron tests
- `apps/web/src/lib/hosted-run/store.ts`
- `apps/web/src/lib/hosted-ingress/store-data.ts`
- Directly coupled `apps/web/test/hosted-run-store.test.ts` and any naming-coupled callers/tests
- `apps/cloudflare/src/user-runner/runner-run-processor.ts`
- Directly coupled Cloudflare runner tests
- `agent-docs/exec-plans/{completed/2026-04-23-cron-runner-store-followups.md,active/COORDINATION_LEDGER.md}`
- Out of scope:
- Behavioral redesigns of assistant cron semantics, hosted-run contracts, runner persistence contracts, or unrelated dirty-tree work already in progress.

## Constraints

- Technical constraints:
- Preserve public APIs, persisted data contracts, and existing retry/finalize semantics.
- Keep the `userId` wire field unchanged where the request only calls for internal naming cleanup.
- Do not revert, absorb, or widen into unrelated in-flight edits already present in the worktree.
- Product/process constraints:
- Follow repo plan/ledger workflow, run required verification, and run required audit passes before handoff.
- Use `gpt-5.4` `xhigh` subagents for the implementation slices requested by the user.

## Risks and mitigations

1. Risk: Cron refactors could accidentally change which jobs stay local versus canonical.
   Mitigation: Keep the visibility/filtering behavior stable, add focused regression coverage where the adapter boundary changes, and verify existing food recurring tests.
2. Risk: Hosted-run cursor helper extraction could blur preserve-vs-clear semantics for optional fields.
   Mitigation: Centralize those semantics in one explicit helper and cover both `undefined` preserve and `null` clear cases in hosted-run store tests.
3. Risk: Runner lifecycle extraction could change operational logging or state transitions.
   Mitigation: Preserve existing phase strings/messages, keep policy differences parameterized, and rerun focused runner tests.

## Tasks

1. Split assistant cron food auto-log creation from the generic add-job flow and extract a shared resolved-job mutation helper for local/canonical mutations.
2. Refactor hosted-run cursor locking/update/failure branches and rename hosted-ingress store-client helpers away from misleading `*Tx` suffixes.
3. Extract a shared run-drain lifecycle helper in the Cloudflare runner while keeping prepare/finalize behavior intact.
4. Run focused verification, required audit passes, and close the task record. Skip a scoped commit if the shared ledger churn would absorb unrelated work.

## Decisions

- Use three `gpt-5.4` `xhigh` worker subagents with disjoint ownership: assistant-engine cron, apps/web hosted-run plus hosted-ingress store helpers, and Cloudflare runner lifecycle.
- Keep the generic assistant-cron target/default resolution unaware of food auto-log inputs by adding a narrow adapter for that compatibility path.
- Preserve the current wire/store semantics for hosted-run optional cursor fields; only make the preserve-vs-clear behavior explicit in shared helpers.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-cron-runtime.test.ts test/assistant-cron-thresholds.test.ts test/food-recurring-cron.test.ts --no-coverage`
- Passed: `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/assistant-cron.test.ts --no-coverage`
- Passed: `pnpm --dir apps/web exec vitest run --config vitest.workspace.ts test/hosted-run-store.test.ts test/hosted-onboarding-member-activation.test.ts --no-coverage`
- Passed: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --project cloudflare-node-runner test/runner-run-processor.test.ts --no-coverage`
- Passed earlier in the lane: `pnpm test:smoke`
- Passed direct scenario: `pnpm exec node --input-type=module` from `packages/cli` created a dedicated food auto-log cron job through `addAssistantFoodAutoLogCronJob()` and read it back through `listAssistantCronJobs()`, yielding `scheduleKind: dailyLocal` and `nextRunAt: 2026-03-08T12:00:00.000Z`
- `coverage-write` ran the exact `pnpm test:diff ...` owner-coverage lane and made no edits because the lane is currently blocked by unrelated `packages/device-syncd/src/store.ts` / `packages/device-syncd/test/*.test.ts` type failures already present in the branch
- `pnpm typecheck` is currently blocked by the same unrelated `packages/device-syncd` test-type failures
- Required audit passes completed: `simplify`, `coverage-write`, `task-finish-review`
- No scoped commit was created because the shared coordination ledger already carries unrelated concurrent churn, so staging it would absorb work outside this task
