# Remove Telegram Inbox Envelope Fallback

## Goal

Delete the dead Telegram auto-reply metadata fallback that parses inbox envelope files from prompt construction, leaving minimized `AssistantInputEvent` metadata as the prompt source of truth.

## Scope

- `packages/assistant-engine/src/assistant/automation/prompt-builder.ts`
- Direct assistant-engine tests that imported or mocked the fallback.

## Constraints

- Preserve the hard-cut invariant that inbox is projection/enrichment only.
- Do not broaden into hosted mailbox, scanner, or runtime state behavior.
- Preserve unrelated dirty work in this checkout.

## Verification

- Targeted assistant-engine prompt/runtime tests.
- `pnpm --filter @murphai/assistant-engine typecheck`
- `pnpm typecheck`
- Completion workflow review passes required for assistant-engine runtime/prompt behavior.
