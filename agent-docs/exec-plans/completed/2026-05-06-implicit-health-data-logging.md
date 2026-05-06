# Implicit Health Data Logging Prompt

## Goal

Make the assistant system prompt explicit that raw user health, meal, supplement, workout, activity, symptom, body, or physical-state data should usually be treated as a request to log it, even when the user phrases it casually or sends only an image/document.

Success criteria:

- The prompt recognizes examples like "I just ate this", meal photos, supplement labels, body measurements, symptoms, and workout/activity snippets as implicit logging intent.
- The rule stays compact and decision-shaped, not a broad rewrite.
- The rule preserves uncertainty handling and does not force logging when the user is clearly asking only for analysis/advice or asks not to save.
- Focused tests pin the prompt behavior.

## Constraints

- Keep the change prompt-only plus focused tests.
- Do not add new tools, schemas, persisted state, or data-source integrations.
- Preserve unrelated working-tree edits.
- Coordinate with the active experiment CLI typed-surface planning row by avoiding experiment-command guidance.
- Follow OpenAI prompt guidance: use a surgical prompt patch, clarify the failure mode explicitly, avoid contradictory broad rules, and keep tool/use policy concise.

## Plan

1. Register this active work in the coordination ledger.
2. Patch `packages/assistant-engine/src/assistant/system-prompt.ts` with a compact implicit logging rule.
3. Add focused prompt regression coverage in `packages/assistant-engine/test/model-behavior.test.ts`.
4. Run focused assistant-engine prompt tests, package typecheck, and required repo typecheck if feasible.
5. Review the scoped diff, close the active plan, and commit only this task's files if unblocked.

## Verification

- PASS: `pnpm --dir packages/assistant-engine exec vitest run test/model-behavior.test.ts --config vitest.config.ts --no-coverage`
- PASS: `pnpm --dir packages/assistant-engine typecheck`
- PASS: `git diff --check -- packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts agent-docs/exec-plans/active/2026-05-06-implicit-health-data-logging.md`
- PASS: `pnpm typecheck`
- PASS: `pnpm build:test-runtime:prepared`
- PASS: `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts`
- NOTE: A prior concurrent rerun of `test:diff` while `pnpm typecheck` was rebuilding/cleaning runtime artifacts failed in CLI reverse-dependent tests with missing `dist` module errors. After `pnpm build:test-runtime:prepared`, the same `test:diff` command passed.
- NOTE: A later `test:diff` rerun was blocked outside this prompt change by unrelated dirty `apps/cloudflare/src/user-runner.ts` idle-shutdown edits, which made `apps/cloudflare` typecheck fail on missing idle-shutdown symbols. The specific timed-out `apps/cloudflare/test/container-entrypoint.test.ts` target passed when rerun directly.

## Handoff Notes

Added a compact prompt rule for raw health/meal/body data as implicit logging intent in normal conversation turns, including privacy gating, incidental-identifier minimization, and analysis-only/do-not-save exceptions. Identifier-bearing details now require an explicit user ask plus permission from the audience/privacy rules and selected write surface. Tightened the older health-data write-surface permission to share the same privacy and analysis-only exceptions. Added focused prompt regression coverage for private/non-private contexts and notification prompts.

Status: completed
Updated: 2026-05-06
Completed: 2026-05-06
