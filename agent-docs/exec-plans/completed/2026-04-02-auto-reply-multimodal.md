# Auto Reply Multimodal

## Goal

Unify assistant auto-reply input preparation with the existing inbox multimodal input path so capable providers can receive image/PDF evidence instead of a text-only prompt.

## Why

- Auto-reply currently builds a text-only prompt from parsed attachment text and skips photo-only captures.
- The inbox routing path already prepares multimodal AI SDK messages from the same capture attachments.
- Keeping these paths separate creates inconsistent behavior for the same inbox evidence.

## Scope

- Shared assistant/provider rich user-message content plumbing.
- Shared inbox attachment evidence helpers reused by inbox routing and assistant auto-reply.
- Focused tests for provider message construction and auto-reply multimodal plumbing.

## Constraints

- Preserve existing text-only behavior for providers that only accept prompt strings.
- Do not widen into unrelated hosted/runtime/provider cleanup.
- Keep transcript/session persistence semantics stable; the durable user prompt remains text.

## Verification

- `pnpm test:smoke`
- `pnpm --filter @murphai/assistant-core build`
- `pnpm exec tsc -p packages/assistant-core/tsconfig.json --pretty false --noEmit`
- `pnpm exec vitest --run --coverage.enabled false packages/cli/test/assistant-provider.test.ts packages/cli/test/assistant-runtime.test.ts`
- `pnpm exec vitest --run --coverage.enabled false packages/cli/test/inbox-model-route.test.ts -t "falls back to text-only when eligible routing images cannot be loaded"`
- `pnpm test:smoke`
- `pnpm typecheck` (currently fails outside this scope in `packages/assistant-runtime/src/hosted-runtime/callbacks.ts` because `@murphai/assistant-core` does not export `normalizeAssistantDeliveryError`)
- `pnpm test:packages` (currently fails outside this scope with broad unrelated package/test breakage after the contracts/test-runtime build stage; this task’s focused assistant tests stay green)

## Audit

- Required `task-finish-review` audit pass before handoff.
- Follow-up audit finding addressed by selecting a multimodal-capable route override when rich input is required and the configured primary provider is text-only.

## Status

- Shared multimodal attachment preparation now lives in `packages/assistant-core/src/inbox-multimodal.ts` and is reused by inbox routing plus assistant auto-reply.
- Assistant provider turns now accept optional rich `userMessageContent` so capable providers can receive image/PDF evidence while text-only providers keep the existing prompt path.
- Auto-reply no longer skips photo-only captures solely because parsed attachment text is absent when rich attachment evidence can be loaded.
- Auto-reply now refuses text-only providers for rich-only captures unless it can reroute the turn onto a configured multimodal-capable provider path.
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
