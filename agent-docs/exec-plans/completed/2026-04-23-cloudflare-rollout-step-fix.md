# Cloudflare rollout step fix

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fix the hosted Cloudflare deploy config so the generated Wrangler container rollout settings pass current Wrangler validation and unblock the production deploy workflow.

## Success criteria

- The generated deploy config no longer emits a rollout step percentage below Wrangler's accepted minimum for container rollouts.
- The checked-in `apps/cloudflare/wrangler.jsonc` scaffold stays aligned with the generated config.
- Directly coupled deploy-config tests are updated and green.
- The touched Cloudflare deploy surface has scripted verification plus a direct config-validation proof.
- A scoped commit contains only this task's repo changes plus plan/ledger closeout.

## Scope

- In scope: `apps/cloudflare` deploy-config generation, the checked-in Wrangler scaffold, directly coupled tests, and plan/ledger bookkeeping.
- Out of scope: broader Cloudflare runtime changes, container rollout strategy redesign, secret/env changes, and unrelated hosted execution work.

## Constraints

- Preserve unrelated dirty-tree edits, especially the existing research tooling changes.
- Keep the fix narrow to the rollout-step validation failure from Actions run `24822238371`.
- Do not expose secrets or copied deploy logs in repo files.

## Tasks

1. [x] Register the task in the coordination ledger.
2. [x] Update the generated and checked-in Cloudflare rollout-step defaults to match current Wrangler validation.
3. [x] Update directly coupled tests and assertions.
4. [x] Run truthful verification for the touched `apps/cloudflare` slice plus direct Wrangler config proof.
5. [x] Complete required audits and create a scoped commit.

## Verification

- `pnpm typecheck` ✅
- `pnpm test:diff apps/cloudflare/scripts/deploy-automation/wrangler-config.ts apps/cloudflare/wrangler.jsonc apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/container-rollout-config.test.ts` ✅
- `pnpm --dir apps/cloudflare exec wrangler deploy --dry-run --config wrangler.jsonc` ✅
  - Before the fix, Wrangler failed validation with `"containers.rollout_step_percentage" array elements must be between 10 and 100, but got "5"`.
  - After the fix, the checked-in config progresses past validation into the Docker build.
- `CF_BUNDLES_BUCKET=hosted-bundles CF_BUNDLES_PREVIEW_BUCKET=hosted-bundles-preview CF_WORKER_NAME=hosted-worker pnpm --dir apps/cloudflare deploy:config:render` ✅
- `pnpm --dir apps/cloudflare runner:bundle` ✅
- `pnpm --dir apps/cloudflare exec wrangler deploy --dry-run --config ./.deploy/wrangler.generated.jsonc` ✅
  - The generated config now validates and completes the dry-run image build without the rollout-step error.
- Required `coverage-write` audit pass (`gpt-5.4-mini`) ✅
  - No additional proof was needed beyond the updated tests and direct dry-run validation evidence.
- Required `task-finish-review` audit pass ✅
  - No findings. Residual risk is limited to live deploy confirmation outside dry-run scope and future upstream Wrangler validation changes.
Completed: 2026-04-23
