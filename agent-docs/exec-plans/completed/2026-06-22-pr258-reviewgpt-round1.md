# PR 258 ReviewGPT Round 1

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Resolve the accepted ReviewGPT round 1 simplification for PR 258.
- Success means Telegram auto-reply text sends omit native `reply_to_message_id`, Telegram reactions still target the inbound message, direct/manual Telegram reply sends remain supported, and the extra reaction-target state is removed.

## Scope

- In scope:
  - `packages/assistant-engine/src/assistant/automation/reply.ts`
  - `packages/assistant-engine/src/assistant/delivery-service.ts`
  - delivery context/contract files touched only to remove `deliveryReactionTargetMessageId`
  - focused assistant-engine and hosted-local Telegram tests
- Out of scope:
  - unrelated app/web CI failure from current `main`
  - new user-facing reply mode configuration
  - Telegram channel adapter explicit reply support

## Decisions

- Accept ReviewGPT's simplification: keep `deliveryReplyToMessageId` as the single inbound-message target and suppress native Telegram text reply anchors only when dispatching text for `automation-auto-reply`.
- Keep reactions and reaction-tool availability reading the normal reply target.

## Verification

- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-service-runtime.test.ts test/assistant-automation-runtime.test.ts test/assistant-delivery-service.test.ts test/assistant-codex-final-coverage.test.ts test/assistant-protocol-index-planning.test.ts`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm hosted-local e2e telegram` with a throwaway local database
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff ...` for the changed assistant-engine and hosted-local Telegram files
- `git diff --check`
- Completion audits: security/privacy no findings, coverage-write no changes, deep-review no production-breaking findings.
Completed: 2026-06-22
