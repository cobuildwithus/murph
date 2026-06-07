# Exercise Catalog Prompt

## Goal

Teach the assistant to ground specific exercise, stretch, mobility, and movement recommendations in the read-only exercise catalog CLI before giving steps or best-practice guidance.
Also teach the assistant to walk users through exercise/therapy-style movement protocols one exercise at a time by default.

## Scope

- Add concise assistant prompt guidance for `vault-cli exercise list/show --format json`.
- Add focused regression tests proving the prompt includes the catalog and pacing rules.

## Constraints

- Keep the prompt outcome-first and short.
- Do not change exercise catalog data, CLI command behavior, or Health Commons protocol logic.
- Preserve existing vault and assistant safety guidance.

## Verification

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/model-behavior.test.ts --no-coverage` passed.
- `git diff --check` passed.
- `pnpm typecheck` passed.
- First scoped `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/system-prompt.ts packages/assistant-engine/test/model-behavior.test.ts` failed only because `packages/cli/test/cli-expansion-document-meal.test.ts` timed out at 45s; that exact test passed on direct rerun.
- Rerun of scoped `test:diff` passed across affected owners and `apps/cloudflare verify`.
- Required final-review subagent was spawned, then user explicitly asked to stop subagents; closed without findings.

## Status

Complete; ready to close and commit.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
