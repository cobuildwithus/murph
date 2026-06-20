# Telegram Reactions

## Goal

Enable assistant reaction side effects for Telegram by reusing the existing
assistant delivery/outbox lifecycle. Current `main` does not retain Linq
reaction support or the old generic reaction slice, so the result should add a
narrow Telegram capability at the existing channel/runtime boundary, avoid new
queues or state owners, and prove Telegram Bot API request shape and assistant
dispatch behavior with focused tests.

## Constraints

- Ask ReviewGPT for the simplest architecture before implementation.
- Preserve the existing assistant delivery/outbox ownership model.
- Do not add durable product state for reactions outside the existing outbox
  lifecycle.
- Telegram provider credentials must stay env/Worker-owned through the existing
  provider egress path.
- Keep logs and diagnostics metadata-only.

## Current State

- PR 213 initially added assistant reaction plumbing, but the merged history
  deleted it as dormant before landing.
- The old `codex/reactions` branch is empty against current `main`.
- This work runs in a new `codex/telegram-reactions` worktree.
- ReviewGPT recommended a Telegram-only capability, a small outbox operation
  union for durability, and no placeholder Linq/runtime reaction plumbing.
- Implementation is complete and verified locally:
  - Telegram runtime helper calls Bot API `setMessageReaction`.
  - Assistant dynamic tool emits reaction actions only when the current delivery
    context supports Telegram message reactions.
  - Existing outbox/hosted delivery primitives carry `message-reaction`
    operations without adding a separate queue or state owner.
  - Ordinary outbox messages persist `operation: null`; only reactions carry an
    explicit operation, while hosted payload parsing still accepts the legacy
    explicit message operation shape for compatibility.
  - Completion audit follow-ups fixed stale deduped reaction updates before
    dispatch, removed local Telegram reaction retry sleeps, and covered hosted
    message-before-reaction payload ordering.
  - Final coverage follow-ups added production route-planning gating proof for
    reaction dynamic tools and explicit legacy hosted message-operation parser
    compatibility proof.

## Plan

1. Inspect the deleted reaction history and current Telegram channel runtime.
2. Ask ReviewGPT for an architecture plan and compare it against current code.
3. Implement the smallest Telegram extension through the existing provider,
   channel, outbox, and hosted delivery seams. (Done)
4. Add focused tests for Telegram request shape, durable reaction dispatch, and
   tool/final-turn behavior. (Done)
5. Run required verification, local audits, scoped commit, PR, CI, and the
   ReviewGPT PR loop to zero accepted findings.

## Verification Target

- `pnpm typecheck`
- `pnpm test:diff <touched files>`
- Additional package/app tests if `test:diff` does not truthfully cover the
  touched owner.

## Verification Run

- Pre-audit `pnpm build:workspace:incremental`, `pnpm typecheck`, and
  `pnpm test:diff` passed.
- Post-audit focused package typechecks and Vitest suites passed for
  operator-config runtime helpers,
  assistant-engine dynamic tool/outbox, hosted-execution side-effects,
  assistant-runtime callbacks, and assistantd HTTP coverage.
- Final post-gap focused verification passed:
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-protocol-index-planning.test.ts` in `packages/assistant-engine`
  - `pnpm exec vitest run --config vitest.config.ts --no-coverage test/side-effects.test.ts` in `packages/hosted-execution`
- Final full verification passed:
  - `pnpm build:workspace:incremental`
  - `pnpm typecheck`
  - `pnpm test:diff`

## Notes

- Avoid expanding hosted runner state, mailbox state, or web control-plane
  ownership for Telegram reactions unless evidence proves the shared reaction
  contract already requires it.
Status: completed
Updated: 2026-06-19
Completed: 2026-06-19
