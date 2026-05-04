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

- `pnpm vitest run packages/assistant-engine/test/provider-registry-helpers.test.ts packages/assistant-engine/test/assistant-protocol-index-planning.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts`
  passed.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/provider-turn-runner.ts packages/assistant-engine/src/assistant/provider-turn/attempt-observability.ts packages/assistant-engine/src/assistant/provider-turn/planning.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/src/assistant/providers/helpers.ts packages/assistant-engine/src/assistant/active-turn-history.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-protocol-index-planning.test.ts packages/assistant-engine/test/provider-registry-helpers.test.ts`
  passed.
- Required security/privacy, simplify, coverage-write, and final completion
  reviews completed; final rerun found no remaining findings.

## Handoff Notes

- Main fix committed in `fb2824f9f` (`fix token consumption bug`).
- Follow-up test/final-review fixes remain staged for scoped commit: final
  no-provider-session session-thread turns clear resume state, empty completion
  usage falls through to `thread/tokenUsage/updated`, and diagnostics payload
  proof covers privacy-safe fields.

Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
