# Hosted Prompt Cache Incident

## Goal

Reduce avoidable uncached hosted Codex provider requests and restore token/cache
observability for hosted GPT-5.5 traffic.

Success criteria:

- Active-turn continuations can reuse the Codex provider thread created earlier
  in the same Murph turn when native resume is available.
- Hosted usage extraction captures Codex token usage update events, including
  cached input tokens.
- Focused tests cover the resume and usage extraction paths.

## Constraints

- Do not store prompts, responses, headers, credentials, personal identifiers,
  local paths, or raw provider bodies.
- Preserve existing stable/dynamic prompt layering and do not reintroduce a new
  `prompt_cache_key` policy in this incident slice.
- Coordinate with the existing provider usage active row; keep edits narrow and
  compatible with token alias work.

## Plan

1. Preserve fresh provider resume state during active-turn provider loops.
2. Extract usage from Codex `thread/tokenUsage/updated` notifications.
3. Add focused tests.
4. Run focused verification, typecheck, and required completion review.
5. Commit the scoped fix.

## Verification

- Pending.

## Handoff Notes

- Pending.

Status: active
Updated: 2026-05-04
