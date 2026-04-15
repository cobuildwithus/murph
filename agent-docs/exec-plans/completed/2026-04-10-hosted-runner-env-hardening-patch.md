# Hosted Runner Env Hardening Patch

## Goal

Land the returned ChatGPT patch for hosted runner env hardening cleanly, preserving hosted browsing and vault CLI behavior while reducing ambient secret exposure in the Cloudflare runner and hosted CLI subprocesses.

## Success Criteria

- The returned patch intent is applied only in the targeted Cloudflare and assistant-engine files.
- Runner env forwarding defaults to the minimal profile set with explicit opt-in profiles for extra integrations.
- Hosted vault CLI subprocesses no longer inherit ambient `process.env` broadly and still receive the explicit turn-scoped env they need.
- Required verification and audit passes for the touched hosted surfaces are completed, or unrelated blockers are documented truthfully.
- One follow-up `review:gpt` request is sent on the same thread and exactly one wake is armed for that thread.

## Constraints

- Preserve unrelated dirty worktree edits, especially the existing `apps/web` changes.
- Keep the change narrowly scoped to the returned patch and any small merge or fallout fixes needed to land it.
- Treat the hosted runner, env handling, and CLI execution boundary as high-risk surfaces.
- Use the repo commit helpers if the task reaches a clean commit point.

## Current Scope

- `apps/cloudflare/README.md`
- `apps/cloudflare/scripts/deploy-automation/environment.ts`
- `apps/cloudflare/src/hosted-env-policy.ts`
- `apps/cloudflare/src/worker-contracts.ts`
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant-cli-tools/execution-adapters.ts`
- Targeted tests or proof files only if required by verification or audit follow-up

## Verification

- Passed: `pnpm --dir ../.. exec vitest run apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/node-runner-hosted-assistant.test.ts apps/cloudflare/test/node-runner.test.ts --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-runner --no-coverage -t "(recomputes hosted email readiness|keeps hosted email readiness disabled|hosted assistant runner env policy|buildHostedRunnerContainerEnv|deploy automation helpers)"`
- Passed: `pnpm --dir packages/assistant-engine exec vitest run test/execution-adapters.test.ts test/provider-turn-runner.test.ts --config vitest.config.ts --no-coverage`
- Passed direct proof: `node --input-type=module -e ...buildHostedRunnerContainerEnv(...)...` confirmed default runner keys omit Telegram/Mapbox/hosted-email while opt-in profiles add them.
- Unrelated blocker: `pnpm typecheck` fails in `packages/cli/test/supplement-wearables-coverage.test.ts` on missing `excerpt`.
- Unrelated blocker: `pnpm test:diff ...` fails on an unrelated assistant-engine package-local typecheck path (`@murphai/contracts` resolution plus existing `assistant/cron.ts` `slug` error).
- Unrelated blocker: `pnpm --dir apps/cloudflare verify` fails broadly on pre-existing lock-runtime errors (`Lock metadata path must be inside the lock directory.`).
- Unrelated blocker: `pnpm --dir packages/assistant-engine test:coverage` fails broadly on the same pre-existing lock-runtime errors and resulting coverage threshold fallout.

## Audit Outcome

- `coverage-write` added one focused regression test in `packages/assistant-engine/test/provider-turn-runner.test.ts` for preserving plan-scoped CLI env in the tool catalog.
- Initial `task-finish-review` found two issues:
  1. hosted-email profile gating was not enforced end-to-end
  2. `HOSTED_ASSISTANT_ZERO_DATA_RETENTION` was not plumbed through deploy/config
- Follow-up fixes landed for both findings.
- Final rerun of `task-finish-review` returned no remaining findings.

## Planned Steps

1. Apply the supplied patch intent and reconcile any small drift against the current repo state.
2. Run the required hosted-surface verification and direct proof for the changed boundaries.
3. Complete the required audit passes, send the requested review follow-up, arm one wake, and finish with the scoped commit.

Status: completed
Updated: 2026-04-10
Completed: 2026-04-10
Completed: 2026-04-10
