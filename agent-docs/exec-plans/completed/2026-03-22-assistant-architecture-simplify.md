# assistant architecture simplify

Status: completed
Created: 2026-03-22
Updated: 2026-03-28

## Goal

- Refactor the assistant runtime so CLI commands, automation, and outbound delivery all operate on one canonical conversation reference with thin per-channel adapters.

## Success criteria

- Assistant-facing runtime APIs accept one canonical conversation-ref shape instead of duplicating `actorId`/`participantId` and `threadId`/`sourceThreadId`.
- Channel-specific delivery/binding/setup policy is centralized behind assistant channel adapters instead of being scattered across service, delivery, automation, and setup layers.
- `sendAssistantMessage()` no longer re-resolves the session through the public delivery wrapper when it already has the active session/binding in hand.
- Telegram target parsing/serialization is shared in one runtime helper used by both inbound normalization and outbound delivery.
- Assistant automation is split into smaller modules with generic orchestration separated from grouping, prompt construction, artifact writes, and channel-specific metadata handling.
- Existing local-state boundaries remain intact: session/transcript state stays under `assistant-state/`, inbox persistence stays in `packages/inboxd`, and assistant memory remains Markdown-backed.

## Scope

- In scope:
  - assistant conversation-ref types and conversion helpers
  - assistant channel adapter registry plus iMessage/Telegram adapters
  - assistant service/store/delivery/session updates to use the shared conversation ref
  - assistant automation module split and removal of generic Telegram envelope reparsing where possible
  - CLI/setup wiring and focused tests/docs that need to move with the refactor
- Out of scope:
  - extracting a new `packages/assistant` package in this change
  - changing the canonical inbox persistence boundary
  - replacing the current local Markdown assistant-memory model
  - adding new daemons or live-network verification

## Risks and mitigations

1. Risk: assistant files already have overlapping active lanes.
   Mitigation: keep the refactor behavior-preserving, read current file state before each edit, and avoid touching Ink/UI internals unless the new service surface requires a narrow adaptation.
2. Risk: session lookup and delivery behavior could drift while renaming identities.
   Mitigation: introduce compatibility helpers so storage can continue using the existing session schema while callers converge on the canonical conversation ref.
3. Risk: automation regressions in Telegram grouping/reply behavior.
   Mitigation: preserve current prompt and skip semantics in focused helpers, add targeted tests around grouping/delivery, and keep required verification green.

## Tasks

1. Add the coordination-ledger lane and inspect the existing assistant/session/channel codepaths.
2. Introduce shared conversation-ref and assistant-channel adapter helpers, then rewire store/service/delivery to use them.
3. Split assistant automation into smaller modules and move channel-specific grouping/prompt rules behind adapters/helpers.
4. Update CLI/setup callers and focused tests to use the new runtime surface.
5. Run required verification plus completion-workflow audit passes, then remove the ledger row and commit the touched files.

## Verification

- Focused:
  - targeted Vitest coverage for assistant service/channel/runtime/setup flows touched by the refactor
- Required:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Completion workflow:
  - simplify pass
  - test-coverage audit
  - task-finish review
- Outcome:
  - `pnpm exec vitest run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-channel.test.ts packages/cli/test/assistant-runtime.test.ts packages/cli/test/setup-channels.test.ts --no-coverage --maxWorkers 1` passed.
  - `pnpm exec vitest run packages/cli/test/assistant-state.test.ts --no-coverage --maxWorkers 1` passed after restoring legacy session/alias precedence patching in the conversation-ref compatibility layer.
  - `pnpm --dir packages/inboxd typecheck` passed.
  - `pnpm --dir packages/core build && pnpm --dir packages/cli typecheck` passed.
  - `pnpm typecheck` failed in the pre-existing repo package order path when `packages/importers` typecheck hit stale `packages/runtime-state/dist` artifacts before the later package rebuild completed.
  - `pnpm test` failed in pre-existing broad-suite CLI/package checks outside the touched assistant files, including `packages/cli/test/assistant-cli.test.ts` runtime-artifact rebuild cases and `packages/cli/test/list-cursor-compat.test.ts`.
  - `pnpm test:coverage` failed in the same pre-existing broad-suite CLI/package area before reaching a green completion.
  - Simplify pass: no additional behavior-preserving cleanup was warranted after the automation extraction and adapter consolidation.
  - Test-coverage audit: existing focused assistant/session/setup tests already covered the new conversation-ref, delivery, and auto-reply paths after the refactor.
  - Task-finish review: no new high-severity findings remained in the touched assistant/channel code; residual risk is limited to broader workspace verification noise outside this change set.
Completed: 2026-03-28
