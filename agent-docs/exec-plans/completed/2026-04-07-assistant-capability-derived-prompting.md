# Make assistant prompt guidance capability-derived

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make provider-turn system prompts advertise only the assistant capability families that are actually reachable in that turn, with explicit fallbacks when a preferred surface is unavailable.

## Success criteria

- The system prompt no longer claims `assistant.knowledge.*` is exposed when the selected route cannot execute structured assistant tools.
- Prompt guidance remains truthful for both tool-runtime providers and non-tool-runtime providers.
- The implementation stays capability-derived rather than hardcoding provider names into prompt text.
- Focused tests cover at least one tool-runtime path and one non-tool-runtime path.

## Scope

- In scope:
- `packages/assistant-engine/src/assistant/provider-turn-runner.ts`
- `packages/assistant-engine/src/assistant/system-prompt.ts`
- focused assistant prompt/runtime tests under `packages/cli/test/**`
- this execution plan and the coordination ledger row for the lane
- Out of scope:
- changing blood-test retrieval behavior itself
- adding new assistant tools or new provider transport capabilities
- redesigning the broader assistant snapshot flow beyond prompt-truthfulness and safe fallback guidance

## Constraints

- Technical constraints:
- Keep the guidance derived from actual reachable tool names/capability families rather than special-casing `codex-cli`.
- Preserve unrelated dirty worktree edits, including nearby assistant runtime changes already in progress.
- Keep the change narrow: prompt generation and focused tests only.
- Product/process constraints:
- The assistant prompt must stay truthful about what the current turn can actually execute.

## Risks and mitigations

1. Risk: the prompt grows more complex while trying to model every tool individually.
   Mitigation: derive a small capability summary in the provider-turn runner and keep the prompt API focused on capability families plus fallback text.

2. Risk: a partial fix updates CLI guidance but leaves knowledge guidance inconsistent.
   Mitigation: route both through the same capability-derived pattern and cover both in tests.

3. Risk: nearby dirty assistant-runtime edits create merge risk.
   Mitigation: re-read files before editing, keep the diff surgical, and avoid touching unrelated symbols.

## Tasks

1. Inspect the current system-prompt inputs and identify where capability truth already exists.
2. Add a narrow capability-derived prompt input for knowledge/tool access guidance.
3. Update tests to assert truthful guidance on both tool-runtime and non-tool-runtime paths.
4. Run required verification and capture the remaining blood-test discussion as a follow-up, not in this diff.

## Decisions

- Derive prompt guidance from actual reachable capability families for the current route rather than branching on provider name.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm exec vitest run packages/cli/test/assistant-service.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage`
- Expected outcomes:
- Focused assistant service/runtime tests pass and confirm prompt truthfulness for both tool-runtime and non-tool-runtime routes.
Completed: 2026-04-07
