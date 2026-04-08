# Align package Vitest configs with the shared coverage threshold helper

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Update package-local `vitest.config.ts` files so coverage threshold policy consistently flows through `config/vitest-coverage.ts`.
- Remove duplicated root-threshold objects where packages already match the shared defaults.
- Express any intentional lower package-specific gates as explicit overrides of the shared helper, rather than standalone threshold objects.
- Keep the shared helper branch requirement at `80`; this lane is wiring alignment, not a root policy change.
- Remove package-local coverage excludes that hide source files or other tracked package files from cross-package coverage accounting.

## Scope

- In scope:
- `packages/*/vitest.config.ts` files that still duplicate or bypass the shared coverage helper
- package-local coverage excludes that omit tracked files from package coverage runs
- this execution plan and the final scoped commit
- Out of scope:
- package-local test additions to raise failing custom packages
- root coverage threshold values in `config/vitest-coverage.ts`
- unrelated package runtime/test logic

## Current state

- `packages/core`, `packages/hosted-execution`, `packages/importers`, `packages/query`, `packages/contracts`, and `packages/cli/vitest.workspace.ts` now all route coverage config through `createMurphVitestCoverage()` in the current worktree.
- `packages/assistant-runtime`, `packages/device-syncd`, and `packages/messaging-ingress` keep their existing threshold posture but no longer hide tracked source files behind package-local `exclude` entries.
- `packages/inboxd` still uses `createMurphVitestCoverage()`, but keeps an inline spread/override threshold object outside this lane.
- Search proof now shows no package-local `exclude` arrays in package Vitest configs or the CLI workspace; only the shared helper still defines the built-in `coverage/**`, `dist/**`, and `**/*.d.ts` filters.

## Verification

- Required commands:
  - `pnpm typecheck`
  - `pnpm test:coverage`
- Focused proof to add during implementation:
  - touched-file config readback
  - search proof showing no remaining package-local coverage excludes beyond the shared helper's built-in `coverage/**`, `dist/**`, and `**/*.d.ts` filters
Completed: 2026-04-08
