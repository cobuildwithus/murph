# Overnight Memory Consolidation

## Goal

Land the supplied Codex hosted-memory patch and extend it so hosted users get an overnight, vault-local-time memory consolidation run through the existing app-server-backed assistant path.

## Constraints

- Keep durable user-facing memory in canonical vault records, not assistant runtime state.
- Use the existing app-server/canonical assistant route for consolidation; do not add a parallel model or second memory owner.
- Keep the scheduled mechanism simple, idempotent, and compatible with foreground conversation priority.
- Preserve hosted web, Cloudflare, and runner deploy-skew behavior.

## Working Set

- `packages/runtime-state/**`
- `packages/assistant-runtime/**`
- `packages/assistant-engine/**`
- `packages/cli/**`
- Hosted runtime docs/tests as needed

## State

- Created branch/worktree for PR lane.
- Supplied patch was checked against current `origin/main` before this plan and applies cleanly.
- Implemented hosted-only daily-local `03:00` managed automation for overnight memory consolidation through the existing scheduled assistant/app-server path.
- Kept durable memory consolidation on the canonical `vault-cli memory` surface and removed Codex generated-memory persistence after ReviewGPT found it would create a second memory owner.
- Added explicit runtime-state test coverage that Codex generated-memory-looking files remain excluded from hosted workspace snapshots.
- Isolated the overnight maintenance notification turn from session transcript/native resume state after ReviewGPT found the cron path still reused the notification session-thread profile.
- Added execution-time hosted-only enforcement before overnight maintenance claims, and made the maintenance turn exact-skip/no-delivery/no-session-persistence after ReviewGPT found seed-time hosted gating and provider-resume isolation were insufficient.

## Verification Plan

- Prefer `pnpm test:diff` over the touched files if it truthfully covers the owner set.
- Run `pnpm typecheck` unless a credible unrelated blocker appears.
- Add direct focused tests for the overnight scheduling/canonical path.
- After PR opens, run the required ReviewGPT PR loop to zero accepted findings.

## Verification Results

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/managed-automations.test.ts test/managed-automations-core.test.ts` in `packages/assistant-engine`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/managed-automations.test.ts test/managed-automations-core.test.ts test/assistant-cron-runtime.test.ts test/assistant-protocol-index-planning.test.ts` in `packages/assistant-engine`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/managed-automations.test.ts test/managed-automations-core.test.ts test/assistant-cron-runtime.test.ts test/assistant-protocol-index-planning.test.ts test/assistant-notification-turn-runtime.test.ts` in `packages/assistant-engine`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-notification-turn-runtime.test.ts test/assistant-cron-runtime.test.ts` in `packages/assistant-engine`
- `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-codex-config.test.ts` in `packages/assistant-runtime`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-bundle.test.ts` in `packages/runtime-state`
- `pnpm build:workspace:incremental`
- `pnpm typecheck`
- `git diff --check`
- `CI=1 pnpm test`
Status: completed
Updated: 2026-07-01
Completed: 2026-07-01
