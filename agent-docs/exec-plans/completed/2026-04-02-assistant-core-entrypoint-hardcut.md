# 2026-04-02 Assistant-Core Entrypoint Hardcut

## Goal

- Remove the wildcard `@murphai/assistant-core/*` publish surface in favor of explicit package entrypoints.
- Keep the CLI, assistantd boundary checks, and repo-local consumers on deliberate assistant-core owner seams instead of deep `assistant/*` imports that were only reachable through the wildcard export.

## Scope

- `agent-docs/exec-plans/active/{2026-04-02-assistant-core-entrypoint-hardcut.md,COORDINATION_LEDGER.md}`
- `packages/assistant-core/{README.md,package.json,src/*.ts}`
- `packages/cli/src/{assistant/**,assistant-runtime.ts,assistant-daemon-client.ts,commands/assistant.ts,run-terminal-logging.ts,setup-*.ts,setup-cli.ts,setup-services{,.ts,/**}}`
- focused boundary/package-shape tests under `packages/cli/test/**` and `packages/assistantd/test/**`

## Findings

- `packages/assistant-core/package.json` still publishes `./*`, which leaks every source file as public API.
- The CLI still imports multiple deep `@murphai/assistant-core/assistant/*` subpaths directly.
- Repo boundary tests currently assert the wildcard export, so the proof surface must change with the implementation.

## Constraints

- Preserve unrelated dirty-tree work, especially the active device-sync and hosted-runtime edits already in progress elsewhere.
- Keep remaining non-assistant helper and `usecases/*` leaf entrypoints that are still part of the intended published surface for this pass.
- Do not widen into assistant/runtime behavior changes; this lane is a publish-surface and import-boundary hard cut.

## Plan

1. Replace the wildcard export with explicit assistant-core entrypoints and add the top-level assistant facade files required by the new public seams.
2. Repoint CLI imports from deep `assistant/*` subpaths onto the curated assistant entrypoints.
3. Update boundary tests so they enforce the explicit export map instead of the removed wildcard.
4. Run focused package checks plus required repo verification, then the required final review audit.

## Verification Target

- Focused:
  - `pnpm --dir packages/cli test -- --run packages/cli/test/assistant-core-facades.test.ts`
  - `pnpm --dir packages/assistantd test -- --run packages/assistantd/test/assistant-core-boundary.test.ts`
- Required:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`

## Status

- Active
- Updated: 2026-04-02
Status: completed
Updated: 2026-04-02
Completed: 2026-04-02
