# Auto-Reply ReviewGPT Fixes

## Goal

Land the accepted PR review fixes for auto-reply cross-session context:

- prevent self-authored Linq echoes from bypassing suppression when provider
  timestamps precede local send/transcript timestamps
- preserve hosted-email same-thread context when serialized reply targets rotate

## Scope

- `packages/assistant-engine/src/assistant/automation/reply.ts`
- focused assistant-engine auto-reply tests

## Constraints

- Keep the fix minimal and avoid introducing a new route identity model,
  durable state owner, queue, or reconciliation loop.
- Use transcript-backed self-echo suppression for self-authored captures.
- Keep outbox lookup limited to confirmed prior assistant context.

## Verification

- Focused assistant-engine auto-reply tests
- `pnpm typecheck`
- `pnpm test:diff` for the touched assistant-engine files
- Required completion audits before commit
Status: completed
Updated: 2026-06-23
Completed: 2026-06-23
