# Harden accepted-input assistant-input refs

## Goal

Make the accepted-input journal fail closed when `source: "assistant-input"` is not backed by the exact assistant input event ref shape:

- `contentRef.kind === "assistant-input-event"`
- `contentRef.refId === input.id`
- `contentRef.version === "murph.assistant-input-event.v1"`

Also add a hosted checkpoint guard so accepted assistant-input ids must resolve to stored `AssistantInputEvent` records before the provider-visible turn checkpoint is accepted.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not widen into hosted mailbox identity generation unless the journal/checkpoint seam requires it.
- Do not persist raw provider payloads, mailbox ids, or prompt text in tests or docs.

## Working Set

- `packages/assistant-engine/src/assistant/active-turn-input-journal.ts`
- `packages/assistant-engine/src/assistant/active-turn-input-controller.ts`
- `packages/assistant-engine/src/assistant/local-service.ts`
- `packages/assistant-engine/test/assistant-active-turn-input-journal.test.ts`
- `packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Verification

Current:

- focused assistant-engine accepted-input journal Vitest
- focused assistant-engine local-service active-turn Vitest
- assistant-engine typecheck and coverage
- required completion audits for persisted-state/trust-boundary change

## State

Implemented after security and final review findings. Broader repo checks are blocked by unrelated dirty-tree `packages/cli` device command type errors.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
