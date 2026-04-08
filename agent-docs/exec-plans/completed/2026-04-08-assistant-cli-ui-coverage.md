# Raise `@murphai/assistant-cli` Ink UI coverage honestly

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Raise package-local coverage for the owned Ink chat UI/controller seams without changing runtime behavior.
- Keep the package coverage scope on `src/**/*.ts`.
- Reuse the existing package-local UI test style and `packages/assistant-cli/test/helpers.ts`.

## Success criteria

- Focused `assistant-cli` UI tests cover the weak seams around controller/model/pause logic, composer/model-switcher/theme helpers, transcript/message rendering, and Ink input-adapter paths.
- Focused package-local UI tests pass after the coverage work lands.
- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck` passes, or any failure is shown to be pre-existing and unrelated.

## Scope

- In scope:
- `packages/assistant-cli/src/assistant/ui/**`
- `packages/assistant-cli/src/assistant-chat-ink.ts`
- `packages/assistant-cli/test/**` for tests that cover the owned seams
- `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-08-assistant-cli-ui-coverage.md}`
- Out of scope:
- `packages/assistant-cli/src/assistant-daemon-client.ts`
- `packages/assistant-cli/src/commands/assistant.ts`
- `packages/assistant-cli/src/run-terminal-logging.ts`
- root/shared coverage config
- other packages
- commits

## Current state

- The package already uses `coverage.include: ["src/**/*.ts"]` in `packages/assistant-cli/vitest.config.ts`.
- The live worktree already contains dirty and untracked `packages/assistant-cli/test/**` files from other work; preserve them and patch carefully on top.
- Known current red baseline: `packages/assistant-cli/test/assistant-ui-rendering.test.ts` and `packages/assistant-cli/test/assistant-ui-state-view-model.test.ts` still expect partial `Key` objects where the helpers now normalize to full `Key` objects.
- Priority coverage gaps are concentrated in `chat-controller.ts`, `ink.ts`, `composer-editing.ts`, `composer-terminal.ts`, `ink-composer-panel.ts`, `model-switcher.ts`, `theme.ts`, `ink-message-text.ts`, `ink-transcript.ts`, `chat-controller-models.ts`, and `chat-controller-pause.ts`.

## Risks and mitigations

1. Risk: overlapping test edits in the shared worktree.
   Mitigation: keep changes scoped to the owned UI tests, read current file state before each patch, and avoid reverting adjacent edits.
2. Risk: fake coverage through behavior changes or broad mocks.
   Mitigation: prefer real helper/component execution plus targeted hook harnesses that preserve the live UI behavior.
3. Risk: `chat-controller.ts` and `ink.ts` depend on runtime and Ink state that are expensive to exercise end to end.
   Mitigation: mock only the runtime boundaries needed to drive controller and input-adapter branches while keeping the owned UI logic real.

## Tasks

1. Fix or adapt the known red UI key-shape expectations narrowly if they block focused coverage runs.
2. Add package-local tests for the owned helper/component/controller seams using the existing UI/runtime test style.
3. Run focused `assistant-cli` tests and package-local typecheck, then close the highest-value remaining honest gaps.

## Verification

- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli test -- assistant-ui-rendering.test.ts assistant-ui-state-view-model.test.ts assistant-ui-runtime.test.ts assistant-ui-helpers.test.ts`
- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck`
- Additional focused `assistant-cli` Vitest commands as needed for the owned UI tests
Completed: 2026-04-08
