# Fix assistant-engine acceptance failures

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Restore a truthful green package-local `packages/assistant-engine` verification lane for the current acceptance failures.
- Keep the fix minimal: change production code only when the current runtime surface is wrong, otherwise update stale tests to match the intended behavior.

## Why

- `pnpm verify:acceptance` is currently red on specific `packages/assistant-engine` assertions and package coverage.
- The reported failures mix public-surface drift (`executeCodexPrompt` missing from the root barrel), runtime-behavior drift (session/store persistence expectations), copy drift (vault overview text), and an uncovered utility file (`src/assistant-codex/images.ts`).

## Scope

- `packages/assistant-engine/src/index.ts`
- `packages/assistant-engine/src/assistant/session-resolution.ts`
- `packages/assistant-engine/src/assistant/store/persistence.ts` only if a production fix is required
- `packages/assistant-engine/src/assistant/vault-overview.ts` only if a production fix is required
- `packages/assistant-engine/src/assistant-codex/images.ts` only if direct proof needs coverage hooks
- directly coupled tests under `packages/assistant-engine/test/**` for the reported failing slices only
- `agent-docs/exec-plans/active/{2026-04-24-assistant-engine-acceptance-fixes.md,COORDINATION_LEDGER.md}`

## Out of scope

- unrelated active `assistant-engine` provider hardening or retention work
- cross-package behavior changes
- repo-wide acceptance or non-package verification

## Constraints

- Preserve unrelated working-tree edits.
- Work only in `packages/assistant-engine/**` plus this plan/ledger registration.
- Treat the active retention row on `src/assistant/store/persistence.ts` as overlapping: keep any change there minimal and additive, or prefer test updates if the current behavior is intended.
- Do not revert or reshape any overlapping assistant-engine work outside the reported failing seams.

## Tasks

1. Register the lane and inspect the current failing assistant-engine tests against implementation.
2. Decide per failure whether the intended fix is code, test, or both.
3. Apply the smallest truthful change set in `packages/assistant-engine`.
4. Run package-local `typecheck` and `test:coverage`, then fix any remaining package-local failures in scope.

## Verification

- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-session-resolution.test.ts test/assistant-store-persistence.test.ts test/assistant-vault-overview.test.ts test/assistant-wrapper-exports.test.ts --config vitest.config.ts --no-coverage`
- `pnpm --dir packages/assistant-engine test:coverage`

## Current results

- Implementation landed as test/proof-only changes in `packages/assistant-engine/test/**`.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-engine exec vitest run test/assistant-session-resolution.test.ts test/assistant-store-persistence.test.ts test/assistant-vault-overview.test.ts test/assistant-wrapper-exports.test.ts test/assistant-codex-images.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/assistant-engine test:coverage` passed (`99` files, `876` tests); `src/assistant-codex/images.ts` reached `100%` statements / branches / functions / lines.
- Required `coverage-write` audit pass ran via `codex-workers` on `gpt-5.4-mini` and reported no further proof changes were needed.
- Required `task-finish-review` audit worker was launched twice via `codex-workers`, but both runs stalled without returning a final findings artifact; the umbrella landing completed after repo-wide `pnpm verify:acceptance` passed with the package lane green.

Completed: 2026-04-24
