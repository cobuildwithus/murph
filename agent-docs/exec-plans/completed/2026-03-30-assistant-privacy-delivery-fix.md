# 2026-03-30 Assistant Privacy Delivery Fix

## Goal

- Ensure assistant sensitive-health-context gating follows the effective delivery audience for the current turn instead of stale session binding state.
- Lock in regression coverage for transcript-distillation malformed committed lines and outbound reply source-reference sanitization.

## Success Criteria

- `resolveAssistantConversationPolicy()` infers private-audience safety from the turn's effective delivery target/directness, including explicit overrides when `threadIsDirect` is absent or stale.
- Turns that target a different or shared audience still withhold sensitive health context.
- Transcript distillation malformed committed lines are covered by a regression test that proves quarantine/surface behavior instead of silent salvage.
- Outbound reply sanitizer tests prove relative markdown links and inline bare vault/derived references are stripped for outbound channels.

## Scope

- `packages/cli/src/assistant/{conversation-policy,transcript-distillation,reply-sanitizer}.ts`
- targeted `packages/cli/test/{assistant-service,assistant-runtime}.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Risks / Notes

- Preserve the in-flight assistant final-cleanup edits already present in the worktree.
- Avoid widening the change into unrelated assistant runtime/service boundary cleanup.
- Treat transcript distillation and sanitizer behavior as high-sensitivity privacy surfaces: prefer explicit failure/quarantine and explicit stripping over silent best-effort behavior.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
