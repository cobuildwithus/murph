# CLI Chat Raw-Mode Regression

## Goal

Restore the fail-closed behavior for the root `murph chat` shorthand when interactive raw-mode input is unavailable, including the `--format json` path.

## Why this exists

- Focused CLI tests now fail because the root `chat` command dereferences a non-Ink result instead of surfacing the explicit interactive-input failure.
- The expected contract is that interactive chat rejects non-raw-mode terminals before any JSON envelope or resume output is emitted.

## Scope

- `packages/cli/test/assistant-cli.test.ts`
- `packages/cli/src/**` only if directly needed for root chat/raw-mode handling
- `packages/assistant-cli/src/**` only if directly needed for the interactive chat gating path

## Non-goals

- Sample import or importer changes
- Broader assistant/runtime refactors outside the chat entry/raw-mode path
- Setup test changes

## Constraints

- Preserve unrelated dirty-tree edits.
- Keep the root `chat` shorthand aligned with `assistant chat`.
- Fail before any JSON result or resume-session handling when interactive input is unavailable.

## Verification target

- Focused `vitest` run for the two raw-mode regression tests
- `pnpm typecheck`
- Required repo completion audits for this scoped code/test change

## Current state

- The assistant chat command now preflights interactive Ink input before delegating to the runtime, reusing the existing raw-mode/controlling-terminal probe and shared error text.
- Root `chat` regression tests are present again in `packages/cli/test/assistant-cli.test.ts` and assert the exact interactive-input failure for both plain output and `--format json`.
- Focused assistant command proof now asserts the command short-circuits before calling the runtime when interactive input is unavailable.

## Verification result

- Passed: `pnpm exec vitest run packages/cli/test/assistant-cli.test.ts --config packages/cli/vitest.workspace.ts --no-coverage -t "root chat"`
- Passed: `pnpm --dir packages/assistant-cli exec vitest run test/assistant-command-coverage.test.ts --config vitest.config.ts --no-coverage -t "assistant chat"`
- Passed: required `coverage-write` audit on `gpt-5.4-mini` with no further test additions needed.
- Review found and we fixed a proof gap where the root regression tests had disappeared from `packages/cli/test/assistant-cli.test.ts` during concurrent edits.
- Failed for a pre-existing unrelated reason: `pnpm typecheck` due `packages/assistantd/test/http-coverage.test.ts(81,3): error TS2353` on unexpected `providerBinding`.
Status: completed
Updated: 2026-04-19
Completed: 2026-04-19
