# Assistant chat UI refresh

Status: active
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Keep the Ink-backed assistant chat visually aligned with the Codex CLI style by refining the composer, transcript, and in-chat model selection affordances.

## Success criteria

- The composer uses the intended pale-gray block, dark-blue cursor, and `›` prompt glyph.
- The footer shows only model/vault metadata, with no redundant command hint line.
- `/model` opens a model plus reasoning picker and applies the chosen model and effort to subsequent Codex turns.
- Sent user messages render as the same pale-gray padded block as the composer instead of a plain right-aligned text line.
- Focused assistant tests pass and required repo checks are attempted with outcomes recorded truthfully.

## Scope

- In scope:
- `packages/cli/src/assistant/ui/ink.ts`
- `packages/cli/src/assistant/ui/view-model.ts`
- `packages/cli/src/{assistant-codex.ts,assistant/service.ts,chat-provider.ts,bin.ts}`
- focused assistant test coverage in `packages/cli/test/{assistant-codex,assistant-runtime}.test.ts`
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- broader assistant persistence changes
- unrelated root CLI/help regressions already present in the worktree
- non-assistant runtime refactors

## Constraints

- Preserve overlapping assistant-lane edits already in flight.
- Keep the changes local to assistant chat UI/provider override wiring.
- Do not revert unrelated dirty worktree state.

## Risks and mitigations

1. Risk: new model-picker state could drift from the actual provider invocation.
   Mitigation: thread reasoning/model overrides through the assistant provider call and cover the argument wiring in focused tests.
2. Risk: transcript styling changes could make user turns harder to scan.
   Mitigation: reuse the same composer palette and padding so the visual language stays consistent.
3. Risk: repo-wide failing lanes could obscure this small UI slice.
   Mitigation: run focused assistant tests plus the required repo checks and record unrelated failures separately.

## Tasks

1. Refine the Ink composer palette and prompt glyph to match the intended Codex-like appearance.
2. Add the `/model` selector and pass the selected model/reasoning effort to Codex.
3. Restyle sent user messages to mirror the composer block.
4. Run required checks, then commit only the scoped files if unrelated repo failures remain.

## Decisions

- Healthy Bob reads the existing Codex config for display/defaults rather than introducing a separate assistant-owned Codex config.
- The in-chat selector is a two-step picker: model first, reasoning effort second.
- Sent user turns use the same pale-gray full-width block as the composer instead of right-aligned colored text.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/assistant-codex.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- focused assistant tests pass
- repo-wide checks may still surface unrelated existing failures outside the touched assistant UI/provider files
