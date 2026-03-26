You are Codex Worker R4 operating in the current shared worktree. Do not create a commit.

Before any code changes:
- Read `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`.
- Add your own row as `Codex Worker R4` with this lane's files/symbols and mark it `in_progress`.
- Keep this patch to channel-adapter files/tests only.

After changes:
- Run the narrowest relevant tests you touch.
- Remove your ledger row before finishing.
- Final response: summary, files changed, tests run, blockers.

Task:

Refactor `packages/cli/src/assistant/channel-adapters.ts` to simplify Telegram retry control flow and collapse duplicated per-channel adapter boilerplate without changing behavior.

Relevant files/symbols:
- `packages/cli/src/assistant/channel-adapters.ts`
  - `sendTelegramMessageDetailed`
  - `sendTelegramTextChunk`
  - `shouldRetryTelegramSend`
  - `extractTelegramMigrateToChatId`
  - `extractTelegramRetryAfter`
  - `getAssistantChannelAdapter`
  - `resolveDeliveryCandidates`
  - `resolveImessageDeliveryCandidates`
  - `inferAssistantBindingDelivery`
  - `inferFallbackBindingDelivery`
  - `IMESSAGE_CHANNEL_ADAPTER`
  - `TELEGRAM_CHANNEL_ADAPTER`
  - `LINQ_CHANNEL_ADAPTER`
  - `EMAIL_CHANNEL_ADAPTER`
- Regression anchors:
  - `packages/cli/test/assistant-channel.test.ts`

Best-guess fix:
1. Replace the `for (...)` plus `attempt -= 1` Telegram retry loop with explicit retry state that preserves retry budget on migration.
2. Split "call the Bot API once" from "decide retry/migration/backoff outcome" helper logic.
3. Introduce a small adapter factory/spec layer for the repeated candidate resolution/send/parse plumbing while keeping per-channel policy differences obvious.
4. Keep `resolveImessageDeliveryCandidates(...)` only if you need a compatibility wrapper with a clear comment.

Guardrails:
- Preserve migrated-chat-id persistence and topic routing semantics.
- Preserve auto-reply eligibility differences between channels.
- Avoid touching assistant service/runtime files in this lane.
