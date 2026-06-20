# PR 228 ReviewGPT Round 3

## Goal

Resolve accepted ReviewGPT round 3 implementation findings on PR 228:

- Do not tear down and reinstall the Kernel private-network route guard on every
  browser action.
- Keep the model-facing JSON schema in sync with runtime validation so provider
  guidance cannot drift from the shared action contract.

## Scope

- Web computer-use generated action code and route-guard tests.
- Assistant dynamic tool action schema construction and directly coupled tests.
- Shared hosted computer action schema only if needed to export schema metadata.

## Non-Goals

- Do not restore a hard final-confirmation handoff boundary; the current PR goal
  is to allow authorized final purchase/booking actions.
- Do not add new tools, queues, approval systems, or browser runtimes.

## Verification

- `pnpm --dir apps/web typecheck:prepared`
- `pnpm --dir packages/assistant-engine typecheck`
- `pnpm exec vitest run --config vitest.workspace.ts --no-coverage test/hosted-execution-computer-use.test.ts`
  from `apps/web`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/assistant-codex-computer-tools.test.ts`
  from `packages/assistant-engine`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff $(git ls-files -m -o --exclude-standard)`
- `git diff --check`
- Changed-file privacy scan for local identifiers

All commands above passed. A follow-up PR ReviewGPT pass will run after this
fix is pushed.
Status: completed
Updated: 2026-06-20
Completed: 2026-06-20
