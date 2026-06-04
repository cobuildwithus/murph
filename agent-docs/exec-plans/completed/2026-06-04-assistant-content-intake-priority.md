# Assistant Content Intake Priority

## Goal

Land the prompt/tool-metadata patch that makes concrete user intent, content inspection, structured health writes, progress updates, and onboarding precedence unambiguous.
Also remove the derived sensitive-health privacy flag from assistant turn planning so privacy does not become prompt-level audience routing.

Success criteria:

- The assistant system prompt includes one global turn-priority resolver.
- Attachment, PDF, lab, meal, supplement, workout, symptom, and logging rules are consolidated into one content-intake/write block.
- Conversation onboarding is eligible but never blocks concrete help.
- `send_progress_update` guidance appears in both system prompt behavior and dynamic tool metadata with the requested first-action semantics.
- Assistant turns assume the bound Murph vault/runtime is private operator context instead of carrying an `allowSensitiveHealthContext` Boolean.
- Focused prompt/tool tests prove the changed contracts.

## Scope

In scope:

- `packages/assistant-engine/src/assistant/system-prompt.ts`
- `packages/assistant-engine/src/assistant/model-behavior.ts`
- `packages/assistant-engine/src/assistant/conversation-policy.ts`
- `packages/assistant-engine/src/assistant/codex-turn/planning.ts`
- `packages/assistant-engine/src/assistant/context-snapshot.ts`
- `packages/assistant-engine/src/assistant/memory/turn-context.ts`
- `packages/assistant-engine/src/assistant-codex/dynamic-tools.ts`
- Focused assistant prompt/tool tests
- `packages/assistant-engine/src/assistant-skill-assets.ts` only if needed for the onboarding trigger hint

Out of scope:

- Rewriting unrelated Murph health, Health Commons, wearable, automation, wiki, or action-integrity prompt rules.
- Changing vault write implementations or import parsers.
- Host-enforced attachment progress injection beyond the prompt/tool metadata.

## Plan

1. Register the overlapping prompt scope in the coordination ledger.
2. Patch prompt construction and tool metadata while preserving unrelated dirty prompt/source-link changes.
3. Update focused tests for the new wording and absence of retired blocks.
4. Run targeted verification and required completion audits.
5. Close the plan and commit the scoped change through `scripts/finish-task` if no overlapping dirty work blocks it.

## Risks

- Existing active work already touches adjacent prompt/test files, so edits must preserve unrelated hunks and avoid broad rewrites.
- Prompt wording controls sensitive health-data handling, so no-overclaim and minimization rules must stay explicit without a prompt-level audience privacy gate.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-progress-prompt.test.ts test/model-behavior.test.ts test/assistant-skill-assets.test.ts test/assistant-protocol-index-planning.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine test` passed.
- `pnpm --dir packages/assistant-runtime test` passed.
- `pnpm --dir packages/assistant-cli test` passed.
- `pnpm --dir apps/web test:prepared -- apps/web/test/hosted-workspace-store.test.ts` passed.
- `pnpm --dir packages/hosted-execution exec vitest run test/hosted-runtime-control.test.ts` passed.
- `pnpm typecheck` failed after assistant-engine, assistant-runtime, assistant-cli, apps/web, apps/cloudflare, and related packages passed; the remaining failure is in the separate CLI guidance lane's `packages/cli/src/commands/samples.ts` dirty change.
- `git diff --check` passed for scoped files.
- Repo scan found no remaining assistant source/test references to `allowSensitiveHealthContext`, the private context env key, or progress availability flags.
- Local security/privacy review found no medium-or-higher issue under the intended private runtime invariant.
- Local finish review found no additional functional findings.
Status: completed
Updated: 2026-06-04
Completed: 2026-06-04
