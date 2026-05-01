# Make assistant input events prompt-ready without inbox projection

Status: completed
Created: 2026-05-01
Updated: 2026-05-01

## Goal

- Make assistant input events independently prompt-ready for capture-less Linq and Telegram messages, including minimized attachment and Telegram reply/media-group context, without depending on inbox projection or inbox envelope reads.

## Success criteria

- `AssistantInputEvent` exposes bounded attachment descriptors and minimized source metadata to scanner/prompt code.
- Auto-reply prompts render descriptor-only attachment context when inbox capture projection is missing.
- Telegram reply context and media-group metadata are read from assistant input first; inbox envelope parsing is legacy fallback only for real inbox captures.
- Hosted and local input staging populate the minimized metadata without raw bytes, filenames, raw provider bodies, or unbounded identifiers in prompt context.
- Focused assistant-engine and assistant-runtime tests cover capture-less attachment prompt context and Telegram metadata.

## Scope

- In scope: assistant-engine input-store/input-source/automation prompt path, hosted conversation assistant-input staging, local inbox capture assistant-input staging, directly coupled tests.
- Out of scope: raw attachment byte hydration, inbox show/projection behavior, provider delivery semantics, hosted mailbox checkpoint ownership, broad active-turn refactors.

## Constraints

- Technical constraints: preserve assistant input idempotency by keeping prompt metadata out of `sourceRef`; keep runtime state versioned and bounded; preserve existing deferred hosted inbox projection edits.
- Product/process constraints: do not expose raw provider identifiers, filenames, URLs, bytes, or user/account identifiers in prompts/logs/docs; preserve unrelated dirty-tree work.

## Risks and mitigations

1. Risk: expanding assistant runtime state could become a second product store.
   Mitigation: store only minimal prompt/delivery context tied to an accepted input event; no raw bytes or user-facing durable truth.
2. Risk: touching a pre-existing dirty hosted import file could absorb unrelated changes.
   Mitigation: inspect existing diff first and keep changes additive around assistant-input staging.

## Tasks

1. Extend assistant input event schema/types with bounded source metadata and descriptor exposure.
2. Render descriptor-only attachment context in prompt construction for capture-less input.
3. Move Telegram metadata reads to event-first source metadata with inbox fallback only for real captures.
4. Populate source metadata from hosted and local input staging.
5. Add focused regression tests.
6. Run verification and required audit passes, then close/commit if safe.

## Decisions

- Keep current provider `replyTarget.messageId` as the current-message id authority; source metadata only stores Telegram `mediaGroupId` and bounded `replyContext`.
- Do not place metadata in `sourceRef` because it would perturb assistant input identity.

## Progress

- Done: event schema/source types now carry attachment descriptors and nullable bounded source metadata.
- Done: prompt/group/reply paths now prefer assistant input event metadata before inbox envelopes and can render descriptor-only attachment context.
- Done: hosted and local input staging populate minimized Telegram source metadata, including hashed Telegram media-group identifiers.
- Done: prompt construction renders only descriptor-level attachment context and the boolean fact that a Telegram media group is present; raw group identifiers are not rendered.
- Done: focused regression tests and typecheck passed.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-input-store.test.ts test/assistant-input-source.test.ts test/assistant-automation-prompt-builder.test.ts test/assistant-automation-support.test.ts test/assistant-automation-runtime.test.ts -t "assistant input event store|store-backed assistant input source|buildAssistantAutoReplyPrompt|prepareAssistantAutoReplyInput|assistant auto-reply grouping|stages local imported captures"`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-mailbox-conversation-import.test.ts`
- Passed: `pnpm --filter @murphai/assistant-engine typecheck`
- Passed: `pnpm --filter @murphai/assistant-runtime typecheck`
- Passed: `pnpm typecheck`
- Passed: `git diff --check` for touched files.
Completed: 2026-05-01
