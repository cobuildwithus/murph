# Assistant Prompt Evidence Followups

## Goal

Fix narrow prompt-evidence followups from review without broadening attachment evidence policy.

Success criteria:

- Grouped auto-reply input read-failure events attribute attachment evidence failures to the correct input even when attachment ordinals repeat across grouped inputs.
- The synchronous auto-reply prompt builder clearly documents that production auto-reply execution should use the async prepared path for materialized bundles and derived files.
- Inline evidence filtering remains conservative until there is a deliberate safe summarization policy for structured text.

## Constraints

- Preserve unrelated dirty working-tree edits and active plan rows.
- Keep the change local to assistant prompt/evidence handling and focused tests.
- Do not add new persisted state or broaden sensitive inline text admission.

## Plan

1. Carry input ids with prepared attachment bundles through the multimodal read path.
2. Add a grouped-input regression for repeated attachment ordinals.
3. Document the synchronous prompt-builder limitation.
4. Run focused assistant-engine tests plus required typecheck.
5. Commit scoped changes only if the dirty worktree can be staged safely.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-automation-prompt-builder.test.ts test/assistant-attachment-evidence-model.test.ts test/assistant-inbox-attachment-evidence.test.ts`
- Passed: `pnpm --dir packages/assistant-engine test:coverage`
- Passed for scoped files: `git diff --check -- packages/assistant-engine/src/assistant/attachment-evidence-model.ts packages/assistant-engine/src/assistant/automation/prompt-builder.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts packages/assistant-engine/test/assistant-attachment-evidence-model.test.ts agent-docs/exec-plans/active/2026-05-04-assistant-prompt-evidence-followups.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Blocked by unrelated active assistant-runtime work: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/attachment-evidence-model.ts packages/assistant-engine/src/assistant/automation/prompt-builder.ts packages/assistant-engine/test/assistant-automation-prompt-builder.test.ts packages/assistant-engine/test/assistant-attachment-evidence-model.test.ts`
  - `packages/assistant-engine` typecheck passed inside this lane.
  - The lane failed when reverse-dependent `packages/assistant-runtime` typecheck reached existing mailbox checkpoint/projection effect result type errors in `packages/assistant-runtime/src/hosted-runtime/mailbox-conversation-import.ts` and related tests.
- Blocked by the same unrelated active assistant-runtime work: `pnpm typecheck`
  - `packages/assistant-engine` typecheck passed inside this lane.

## Handoff Notes

- Fixed grouped auto-reply read-failure attribution by carrying input ids alongside prepared attachment bundles.
- Documented `buildAssistantAutoReplyPrompt()` as a sync tests/diagnostics renderer; production auto-reply execution should use `prepareAssistantAutoReplyInput()`.
- Left conservative inline evidence filtering unchanged; JSON summarization needs an explicit safe structured-text policy to avoid broadening sensitive inline admission.
- Scoped commit was not created because the checkout has overlapping dirty work in shared assistant-engine test files and active assistant-runtime files.

Status: completed
Updated: 2026-05-04
Completed: 2026-05-04
