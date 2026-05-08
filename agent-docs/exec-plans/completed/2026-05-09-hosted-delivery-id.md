# Hosted Delivery ID

## Goal

Make hosted foreground assistant replies use deterministic provider delivery idempotency keys across replay after pre-idle container loss.

Success criteria:

- Hosted mailbox replay for the same conversation input set produces the same delivery idempotency key.
- Recipient, channel, conversation, or inbound mailbox identity changes produce a different key.
- Existing random local outbox `intentId` behavior remains local-only and no new dispatch lifecycle owner is introduced.

## Constraints

- Keep architecture simple: use existing outbox `deliveryIdempotencyKey` plumbing.
- Do not make local outbox ids deterministic.
- Avoid raw provider/message content in logs, fixtures, or persisted examples.
- Preserve unrelated dirty worktree edits.

## Current State

Hosted auto-reply sends now provide a deterministic `deliveryIdempotencyKey`
before local outbox intent creation. The local random outbox `intentId` remains
local-only. Active-turn admission recomputes the hosted key after accepted late
same-conversation input so foreground active-turn delivery matches replay over
the final hosted mailbox input set.

## Plan

1. Add a small deterministic hosted delivery-id helper.
2. Compute hosted auto-reply keys from hosted execution member id, channel, conversation, staged hosted mailbox item ids, recipient key, and a stable assistant turn ordinal.
3. Pass the key through existing `deliveryIdempotencyKey` fields.
4. Add focused tests for replay stability and changed dimensions.
5. Run focused verification and required audits.

## Verification

- `pnpm --dir packages/assistant-engine test -- assistant-automation-runtime.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed.
- `pnpm typecheck` passed.
- `git diff --check -- packages/assistant-engine/src/assistant/hosted-delivery-id.ts packages/assistant-engine/src/assistant-automation.ts packages/assistant-engine/src/assistant/automation/reply.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/turn-input.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts agent-docs/exec-plans/active/2026-05-09-hosted-delivery-id.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/hosted-delivery-id.ts packages/assistant-engine/src/assistant-automation.ts packages/assistant-engine/src/assistant/automation/reply.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/turn-input.ts packages/assistant-engine/test/assistant-automation-runtime.test.ts` passed dependency/boundary/hosted/log guards and assistant-cli, assistant-engine, assistant-runtime, assistantd typecheck/test lanes; failed in unrelated `packages/cli` document/meal tests:
  `document-meal-intervention-coverage.test.ts` and `cli-expansion-document-meal.test.ts`.
Status: completed
Updated: 2026-05-09
Completed: 2026-05-09
