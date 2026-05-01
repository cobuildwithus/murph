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

- `pnpm --dir packages/assistant-engine test -- assistant-automation-prompt-builder.test.ts assistant-automation-support.test.ts assistant-automation-runtime.test.ts` passed; the package script ran all assistant-engine tests.
- `pnpm --filter @murphai/assistant-engine typecheck` passed.
- `pnpm typecheck` was blocked by unrelated `packages/hosted-local-harness` type errors.
- Diff verification expanded into unrelated Cloudflare reverse-dependent tests and was blocked by hosted email nudge expectation failures.
- Assistant-engine coverage was blocked by unrelated provider/session/hosted device-connect failures.
- Required coverage-write, security/privacy, and final-review passes reported no findings or no additional in-scope proof needed.
Status: completed
Updated: 2026-05-01
Completed: 2026-05-01
