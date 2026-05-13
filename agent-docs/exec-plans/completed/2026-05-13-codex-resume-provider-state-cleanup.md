# Codex Resume Provider State Cleanup

## Goal

Remove provider-shaped assistant resume-state helpers from the hot path now that
assistant conversations persist a centralized `codexResume` object.

Success criteria:

- Assistant runtime code reads resume state through `readAssistantCodexResume`.
- Assistant conversation persistence uses
  `serializeAssistantConversationForPersistence`.
- The assistant-engine hot path imports the Codex resume/conversation persistence
  helper instead of the old `provider-state.ts` compatibility module.
- Operator-config v1 parser compatibility for legacy `resumeState` /
  `providerSessionId` records remains intact.
- Focused assistant-engine tests cover legacy parsing and current v2
  serialization.

## Constraints

- Keep the change behavior-preserving for persisted assistant conversations.
- Do not modify unrelated Murph Age worktree edits.
- Work on top of the current Codex runtime naming/security follow-up diff
  without reverting it.
- Preserve redaction and data-minimization behavior from the prior cleanup.

## Plan

1. Map `provider-state.ts` callers and test coverage.
2. Replace hot-path imports/callers with Codex-specific helper names.
3. Delete the provider-shaped compatibility module and write/no-op helpers.
4. Update focused seam tests and static guards.
5. Run assistant-engine typecheck/tests plus scoped verification where possible.

## Verification

- PASS: `pnpm --dir packages/assistant-engine typecheck`
- PASS: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/codex-seams.test.ts`
- PASS: `pnpm typecheck`
- PASS: `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/assistant-codex.test.ts`
- FAIL then fixed: initial scoped `bash scripts/workspace-verify.sh test:diff ...`
  exposed a downstream CLI test still asserting the old raw
  `providerSessionId` abort context despite the current redacted
  `codexThreadIdPresent` contract.
- PASS: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/conversation-persistence.ts packages/assistant-engine/src/assistant/provider-state.ts packages/assistant-engine/src/assistant-provider.ts packages/assistant-engine/src/assistant/turn-finalizer.ts packages/assistant-engine/src/assistant/codex-turn/planning.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/state-secrets.ts packages/assistant-engine/src/assistant/store/persistence.ts packages/assistant-engine/src/assistant/store.ts packages/assistant-engine/src/assistant/service-result.ts packages/assistant-engine/src/assistant/session-resolution.ts packages/assistant-engine/test/codex-seams.test.ts packages/cli/test/assistant-codex.test.ts agent-docs/exec-plans/active/2026-05-13-codex-resume-provider-state-cleanup.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS: `git diff --check -- <task paths>`

## Handoff Notes

- Replaced `provider-state.ts` with `conversation-persistence.ts`, exporting
  only `readAssistantCodexResume` and
  `serializeAssistantConversationForPersistence`.
- Runtime callers now read `codexResume` through the new helper and serialize
  assistant conversations through the renamed persistence helper.
- Focused seam coverage now proves legacy v1 parsing remains in
  `operator-config` and current v2 serialization persists `codexResume`.
- Updated the downstream CLI abort test to assert the redacted Codex-thread
  presence flag instead of the removed raw provider session id.
- Committed together with the overlapping Codex runtime naming/security cleanup
  after the user explicitly requested commit; unrelated active ledger/web changes
  were left unstaged.

Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
