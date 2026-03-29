# 2026-03-30 AssistantD Hardening Follow-Up

## Goal

- Close the remaining AssistantD and assistant-runtime hardening gaps around delivery-audience privacy, opaque runtime-id validation, daemon contract/build proof, and bound runtime-state helpers.

## Success Criteria

- Daemon-backed `open-conversation` remains contract-compatible and is exercised through the HTTP route/tests.
- `murph/assistant-core` continues to expose the shared assistant session-id validator needed by `assistantd`, with direct proof in package tests.
- Assistant runtime paths that derive filenames from assistant ids validate those ids before joining filesystem paths.
- Sensitive health-context exposure is decided from the effective delivery audience for the current turn, not only the stored session binding.
- Outbound reply sanitization strips remaining relative-path and inline local references without breaking legitimate slash commands or HTTPS links.
- `AssistantRuntimeStateService` binds the vault consistently across its memory helpers.

## Scope

- `packages/assistantd/src/http.ts`
- `packages/assistantd/test/{http,assistant-core-boundary}.test.ts`
- `packages/cli/src/assistant/{conversation-policy,cron/store,reply-sanitizer,runtime-state-service}.ts`
- targeted `packages/cli/test/{assistant-runtime,assistant-service}.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Risks / Notes

- `packages/cli/src/assistant/reply-sanitizer.ts` and `packages/cli/test/assistant-service.test.ts` already have adjacent in-flight edits in another narrow sanitizer lane; preserve those changes and only extend them if needed.
- The worktree contains unrelated active changes across hosted, contracts, query, and workout areas; do not revert or reshape them while landing this follow-up.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
