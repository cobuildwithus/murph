## Goal

- Reduce deploy-time interruption for hosted Cloudflare container users by making container replacement less aggressive during `wrangler deploy`, without widening the task into Worker gradual-deployment plumbing.

## Success criteria

- The rendered Cloudflare deploy config applies a non-zero active-container grace period and multi-step container rollout.
- The checked-in `apps/cloudflare/wrangler.jsonc` scaffold stays aligned with the rendered deploy config.
- Focused verification covers the changed Cloudflare rollout config surface, and any unrelated blocker is called out precisely.

## Scope

- In scope: `apps/cloudflare` deploy config generation, the checked-in Wrangler scaffold, focused tests, and active plan/ledger bookkeeping.
- Out of scope: Worker gradual-deployment plumbing, Durable Object migration flow changes, runtime retry refactors, log reclassification, and GitHub workflow env-surface changes.

## Constraints

- Preserve unrelated dirty-tree edits, especially the in-flight deploy workflow and deploy-helper var lane.
- Keep the change narrow and config-first: improve rollout behavior without changing runtime contracts.
- Avoid new environment-variable surface unless it is strictly required.

## Tasks

1. [x] Register the task in the coordination ledger.
2. [x] Add conservative container rollout defaults to the rendered deploy config and the checked-in Wrangler scaffold.
3. [x] Add focused proof that the rendered and checked-in configs stay aligned on rollout settings.
4. [ ] Run required verification, audits, and a scoped commit.

## Verification

- `pnpm typecheck` -> passed
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts test/container-image-contract.test.ts test/container-rollout-config.test.ts` -> passed (`3` files, `27` tests)
- `pnpm test:diff apps/cloudflare/scripts/deploy-automation/wrangler-config.ts apps/cloudflare/wrangler.jsonc apps/cloudflare/test/container-rollout-config.test.ts apps/cloudflare/test/deploy-automation.test.ts` -> passed and widened to `apps/cloudflare verify` (`58` files, `440` tests)
- `git diff --check` -> passed
- Direct scenario proof: rendered `apps/cloudflare/.deploy/wrangler.generated.jsonc` with minimal env and confirmed `rollout_active_grace_period: 300` plus `rollout_step_percentage: [5, 25, 50, 100]`
- Required `coverage-write` audit (`gpt-5.4-mini`) -> no further proof changes needed
- Required `task-finish-review` audit -> no findings
