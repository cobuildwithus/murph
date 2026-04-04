# Split remaining CLI ink picker and controller seams

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Split the two remaining large seams out of `packages/cli/src/assistant/ui/ink.ts`: the model-picker UI/state helpers and the assistant chat controller / prompt-turn orchestration flow.
- Keep chat behavior unchanged while leaving `ink.ts` focused on Ink layout, theme wiring, and app bootstrap.
- Bring every touched UI seam file in this refactor path down to at most 600 lines by extracting smaller ownership modules instead of leaving new oversized files behind.

## Success criteria

- `packages/cli/src/assistant/ui/ink.ts` no longer defines the model-switcher component or the `useAssistantChatController` / `runAssistantPromptTurn` flow.
- The extracted picker and controller logic live in focused UI modules with stable imports and no behavior regressions in the chat flow.
- Existing helper exports used by tests continue to resolve from `ink.ts`, either directly or via re-export.
- Every touched file in the extracted seam path is 600 lines or fewer after the refactor.
- Focused CLI tests cover the newly extracted boundaries well enough to verify the refactor even if unrelated assistant-runtime workspace blockers remain.

## Scope

- In scope:
- Extract picker UI/state helpers into a dedicated UI module.
- Extract prompt-queue / turn-state / selection-sync / prompt-turn orchestration and the chat controller hook into a dedicated UI module.
- Add or retarget focused CLI tests and wire them into `packages/cli/vitest.workspace.ts`.
- Out of scope:
- Changing chat commands, delivery behavior, provider semantics, or the composer/editor behavior already extracted.
- Splitting `packages/assistant-core/src/assistant-codex.ts`.

## Constraints

- Technical constraints:
- Preserve the current `ink.ts` export surface for helpers that `packages/cli/test/assistant-runtime.test.ts` already imports.
- Avoid touching unrelated dirty assistant-core / runtime / inboxd work already present in the tree.
- Product/process constraints:
- Follow repo code workflow for a plan-bearing repo change: coordination ledger, focused verification, scoped commit via `scripts/finish-task`, and clear handoff of any unrelated blockers.

## Risks and mitigations

1. Risk: The controller extraction can accidentally break prompt queue replay, pause handling, or model-selection persistence because the current hook mixes several concerns.
   Mitigation: Preserve the existing control flow, move logic mostly verbatim first, then add focused tests on the extracted pure helpers before cleanup.
2. Risk: `ink.ts` helper exports are part of the current CLI test surface, so moving code could break import paths even if runtime behavior stays the same.
   Mitigation: Re-export the extracted helpers from `ink.ts` and keep test-facing names stable.
3. Risk: The repo already has unrelated workspace dependency/import churn that may block baseline `pnpm` verification.
   Mitigation: Run the highest-signal focused CLI tests and direct typecheck available in-tree, and record any unrelated blockers explicitly.

## Tasks

1. Register the active ledger row and inspect the current picker/controller dependencies inside `ink.ts`.
2. Extract the picker UI/state seam into a focused module and update `ink.ts` to consume it.
3. Extract the chat controller / prompt-turn seam into a focused module and update `ink.ts` to consume and re-export the moved helpers.
4. Add focused tests for the extracted seams and wire them into the CLI Vitest workspace.
5. Run the highest-signal verification available, complete the scoped repo workflow, and finish with a path-scoped commit.

## Decisions

- Preserve `runAssistantChatWithInk` in `ink.ts`; it remains the top-level bootstrap/layout boundary for the Ink app even after the picker and controller seams move out.
- Prefer stable re-exports from `ink.ts` over forcing the wider test surface to adopt new module paths in the same refactor.

## Verification

- Commands to run:
- `./node_modules/.bin/vitest --config packages/cli/vitest.workspace.ts --run packages/cli/test/assistant-chat-composer.test.ts packages/cli/test/assistant-chat-controller.test.ts packages/cli/test/assistant-model-switcher.test.ts`
- `./node_modules/.bin/tsc -p packages/cli/tsconfig.typecheck.json --pretty false`
- `./node_modules/.bin/vitest --config packages/cli/vitest.workspace.ts --run packages/cli/test/assistant-runtime.test.ts`
- `pnpm --dir packages/cli typecheck`
- `pnpm --dir packages/cli exec vitest --config vitest.workspace.ts --run test/assistant-chat-composer.test.ts test/assistant-chat-controller.test.ts test/assistant-model-switcher.test.ts test/assistant-runtime.test.ts`
- Expected outcomes:
- Focused extracted-seam tests and CLI typecheck pass, repo-native targeted `pnpm` verification passes, and the refactor path leaves no touched file above the 600-line ceiling.

## Outcome

- Extracted the remaining Ink seams, then followed through by splitting the new oversized controller/composer/Ink modules into smaller composable owners:
- `composer-editor.ts` is now an index over `composer-terminal.ts`, `composer-state.ts`, `composer-editing.ts`, and `composer-render.ts`.
- `chat-controller.ts` now delegates prompt-turn runtime, model catalog/persistence, and pause-shortcut logic to focused helpers.
- `ink.ts` now acts as the runner and terminal-input adapter while layout, message rendering, transcript rendering, and composer/footer panels live in dedicated modules.
- All touched files in the refactor path now satisfy the 600-line ceiling.
Completed: 2026-04-05
