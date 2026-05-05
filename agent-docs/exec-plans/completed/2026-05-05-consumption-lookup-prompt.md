# Consumption Lookup Prompt

## Goal

Make the assistant prompt explicit that identifiable foods, drinks, menu items, supplements, pills, powders, and similar consumed products should be looked up before logging when key ingredient or nutrition facts are missing.

Success criteria:

- The assistant prompt uses a concise decision rule, not broad always/never process language.
- The rule covers identifiable consumed products and missing key facts.
- The rule names the useful recovered fields: serving size, ingredients, active compounds, dose, calories, macros, caffeine, alcohol, sodium, sugar, allergens, and warnings.
- The rule has clear stopping/fallback behavior for generic items, "just note it" requests, unavailable evidence, and uncertainty.
- Focused tests pin the prompt behavior.

## Constraints

- Keep the change prompt-only plus focused tests.
- Do not add new tools, schemas, persisted state, or data-source integrations.
- Preserve unrelated working-tree edits.
- Coordinate with the active experiment CLI typed-surface planning row by avoiding experiment-command guidance.
- Follow OpenAI GPT-5.5 prompt guidance: concise outcome-first rules, decision rules for search, and explicit missing-evidence behavior.

## Plan

1. Register this active work in the coordination ledger.
2. Patch `packages/assistant-engine/src/assistant/system-prompt.ts` with a compact consumption lookup rule.
3. Add a focused prompt regression test in `packages/assistant-engine/test/model-behavior.test.ts`.
4. Run focused assistant-engine prompt tests, `pnpm typecheck`, and a scoped diff-aware verification lane if feasible.
5. Review the scoped diff, close the active plan, and commit only this task's files.

## Verification

- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/model-behavior.test.ts --config vitest.config.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-engine typecheck`
- PASS: `pnpm --dir packages/assistant-engine test:coverage`
- BLOCKED by unrelated existing guard finding: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts`
- BLOCKED by unrelated existing guard finding: `pnpm typecheck`

The blocked checks both stop on `apps/cloudflare/src/runtime-bridge-workspace.ts` raw health/model/vault payload logging, which is outside this task's working set.

## Handoff Notes

- Added a compact consumption lookup decision rule to the assistant health reasoning prompt.
- Added a focused prompt regression test and updated the static prompt hash snapshot.

Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
