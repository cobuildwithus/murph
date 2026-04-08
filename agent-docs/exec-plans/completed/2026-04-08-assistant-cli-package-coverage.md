# Raise `@murphai/assistant-cli` package-local coverage for owned seams

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Add deterministic package-local tests for the owned assistant-cli seams: top-level assistant command registration and behavior, terminal logging, daemon client helpers, and thin entrypoints.
- Keep runtime behavior unchanged and stay within the owned files plus package-local tests.

## Success criteria

- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck` passes.
- `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli test:coverage` passes.
- Coverage stays honest with `include: ["src/**/*.ts"]` and no root/shared config changes.

## Scope

- In scope:
- `packages/assistant-cli/src/{commands/assistant.ts,run-terminal-logging.ts,assistant-runtime.ts,assistant-chat-ink.ts,index.ts,assistant-daemon-client.ts}`
- `packages/assistant-cli/test/**`
- `agent-docs/exec-plans/{active/COORDINATION_LEDGER.md,completed/2026-04-08-assistant-cli-package-coverage.md}`
- Out of scope:
- root config
- other packages
- `packages/assistant-cli/src/assistant/**`
- `packages/assistant-cli/src/assistant/ui/**`
- commits

## Outcome

- Added focused command-registration and command-behavior tests that cover root aliases, saved self-target defaults, foreground run logging hooks, session inspection, and self-target management without end-to-end flows.
- Added daemon-client tests for route building, payload parsing, HTTP error propagation, pre-response fetch failures, and cron/session helper branches.
- Added foreground logging coverage for additional assistant/inbox event formatting branches and a shallow root-barrel re-export test.

## Verification

- Passed: `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli exec vitest run test/assistant-command-coverage.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli exec vitest run test/assistant-package-surface.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli exec vitest run test/assistant-daemon-client-more.test.ts --config vitest.config.ts --no-coverage`
- Passed: `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli exec vitest run test/assistant-ui-logging.test.ts --config vitest.config.ts --no-coverage`
- Passed but coverage thresholds still failed for other package files: `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli exec vitest run test/assistant-command-runtime.test.ts test/assistant-command-coverage.test.ts test/assistant-daemon-client-more.test.ts test/assistant-ui-logging.test.ts test/assistant-package-surface.test.ts --config vitest.config.ts --coverage`
- Failed for unrelated pre-existing package issues outside the owned seam:
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli typecheck`
  - `pnpm --config.verify-deps-before-run=false --dir packages/assistant-cli test`
