# CLI Guidance Regression Fixes

State: Ready to close
Owner: Codex
Started: 2026-06-06

## Goal

Fix the reviewed CLI guidance regressions so agent-facing examples are copyable and truthful:

- quoted multi-word `supplement save` titles
- no duplicated nested command paths in command-local `--llms-full`
- no shell-redirection placeholders in supplement examples
- no comma-joined repeatable `--query` examples

## Constraints

- Keep the change scoped to `packages/cli` guidance and tests.
- Prefer the existing Incur command metadata path; do not add a parallel command manifest unless the renderer cannot be corrected locally.
- Preserve unrelated dirty work and existing ledger rows.

## Plan

1. Patch the smallest CLI guidance/rendering surface.
2. Add focused regressions for rendered root and leaf guidance.
3. Run focused CLI checks plus required scoped verification.
4. Commit through `scripts/finish-task`.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-discoverability.test.ts packages/cli/test/supplement-save-typed-parity.test.ts` passed.
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-entry.test.ts` passed.
- `pnpm exec tsc --noEmit --pretty false --project packages/cli/tsconfig.json` passed.
- `pnpm --dir packages/cli build` passed.
- Built CLI direct checks passed for scoped supplement/workout LLM markdown and supplement root JSON examples.
- `bash scripts/workspace-verify.sh test:diff packages/cli/src/cli-entry.ts packages/cli/src/commands/supplement.ts packages/cli/src/vault-cli.ts packages/cli/src/vault-cli-llms-normalizer.ts packages/cli/test/cli-entry.test.ts packages/cli/test/cli-expansion-discoverability.test.ts packages/cli/test/supplement-save-typed-parity.test.ts` passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.
- Further audit subagents skipped by explicit user instruction.
Status: completed
Updated: 2026-06-06
Completed: 2026-06-06
