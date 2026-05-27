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
2. Locate final-reply outbox delivery resolution and reuse it for progress
   delivery with distinct idempotency keys.
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

- Pending. Draft PR requested before the full audit/verification pass.

## State

- Worktree and branch created from `origin/main`.
- Plan/ledger registration complete.
- Codex dynamic tool protocol mapped: thread start uses `dynamicTools`; app-server requests dynamic tool execution with `item/tool/call`.
- Existing final-reply outbox routing mapped; progress delivery will reuse the current turn audience resolution with progress-specific idempotency keys.
- Initial implementation and focused tests are staged for a draft PR before verification.
