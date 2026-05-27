## Goal

Add one model-visible Codex dynamic tool, `murph.send_progress_update`, that
lets the model send brief model-authored progress updates through the current
assistant turn audience without exposing arbitrary message routing.

## Constraints

- Keep progress current-turn scoped. The model provides text only; runtime
  resolves audience, channel, actor, identity, thread, target, reply target,
  subject, and dispatch mode from the existing turn context.
- Do not expose `send_message`, channel routing, target routing, persistence
  controls, or recipient choice to the model.
- Do not forward Codex/provider progress summaries as user-visible progress.
- Progress failure must be best-effort and must not fail the assistant turn.
- Keep progress text short, truthful, user-facing, and bounded. For lab reports
  or blood tests, progress may acknowledge receipt and work to extract/check/save
  results, but must not interpret, diagnose, or recommend.
- Preserve unrelated active work and do not touch hosted runner files.

## Plan

1. Locate Codex dynamic tool specification and app-server request handling.
2. Locate final-reply delivery resolution and reuse the current audience
   payload shape for progress with distinct idempotency keys, without creating
   final-reply outbox intents or repairing the active turn receipt.
3. Add `AssistantTurnProgress` with normalization, dedupe, and per-turn rate
   limits.
4. Register the single `murph.send_progress_update` dynamic tool in the Codex
   prompt/tool surface.
5. Handle only that dynamic tool request in the Codex app-server wrapper and
   reject all other unsupported dynamic tool calls.
6. Add focused tests for delivery, argument validation, unsupported tools,
   best-effort failure behavior, idempotency separation, provider-summary
   non-forwarding, and transcript non-persistence.
7. Run scoped verification plus required security/privacy, coverage, and final
   completion audits.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-runtime.test.ts test/assistant-turn-progress.test.ts test/model-behavior.test.ts test/assistant-service-runtime.test.ts test/assistant-local-service-runtime.test.ts`
- Passed: `pnpm typecheck`
- Passed: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant-codex/dynamic-tools.ts packages/assistant-engine/src/assistant-codex/app-server-requests.ts packages/assistant-engine/src/assistant/codex-turn-runner.ts packages/assistant-engine/src/assistant/codex-turn/planning.ts packages/assistant-engine/src/assistant/delivery-service.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/model-behavior.ts packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/src/assistant/turn-progress.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts packages/assistant-engine/test/assistant-turn-progress.test.ts packages/assistant-engine/test/model-behavior.test.ts`
- Required completion audits are pending.

## State

- Worktree and branch created from `origin/main`.
- Plan/ledger registration complete.
- Codex dynamic tool protocol mapped: thread start uses `dynamicTools`; app-server requests dynamic tool execution with `item/tool/call`.
- Draft PR opened before full verification at the user's request.
- Reviewer lifecycle fixes are implemented: final replies short-circuit before hosted idempotency when delivery is disabled, progress bypasses receipt-repairing outbox intents, progress sinks are created only when delivery can be user-visible, progress prompt guidance is gated to new threads with the registered tool, dynamic-tool parsing is synchronous, and the tool response now says progress was accepted.
- Focused package tests, root typecheck, and diff-aware workspace verification passed. Required completion audits are next.
