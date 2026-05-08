# DeepSec Clean Fixes

## Goal

Fix the ten verified DeepSec issues with small, durable changes that preserve the existing owner boundaries and avoid new broad abstractions.

## Scope

- `apps/web/src/lib/device-sync/prisma-store/webhook-traces.ts`
- `apps/web/prisma/schema.prisma`
- `apps/web/prisma/migrations/**`
- `apps/web/src/lib/hosted-onboarding/member-identity-service.ts`
- `apps/web/src/testing.ts`
- focused `apps/web/test/**`
- `packages/assistant-cli/src/commands/assistant.ts`
- `packages/assistant-engine/src/assistant/cron/**`
- `packages/assistant-engine/src/assistant/store/**`
- `packages/assistant-engine/src/knowledge/service.ts`
- focused assistant tests
- `packages/vault-usecases/src/usecases/food.ts`
- `packages/vault-usecases/src/usecases/explicit-health-family-services.ts`
- `packages/vault-usecases/src/usecases/types.ts`
- `packages/cli/src/commands/{food,health-blood-test-save,protocol}.ts`
- focused CLI/usecase tests

## Constraints

- Prefer local invariants over new coordination layers.
- Preserve unrelated dirty worktree edits and active DeepSec high-bug work.
- Keep persisted schema additions minimal and backward-compatible where possible.
- Do not log or expose raw personal data, secrets, local usernames, or home paths.

## Verification

- Add focused regressions for each touched behavior where practical.
- Run focused test suites for changed areas.
- Run `pnpm typecheck`.
- Run the required completion audits before commit or handoff.

## Status

- Implemented all ten verified fixes.
- Follow-up audit findings addressed:
  - webhook trace completion now reports lost claims and stale completions abort side effects;
  - canonical cron now rechecks the claim before side effects and skips stale run append/finalization;
  - protocol list result filters include `commonsProtocol`.
- `.deepsec` file records and regenerated report mark the ten findings as `revalidation.verdict: "fixed"`.
- Focused verification passed for touched packages; full repo/web checks are blocked by unrelated dirty-work failures outside this plan.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
