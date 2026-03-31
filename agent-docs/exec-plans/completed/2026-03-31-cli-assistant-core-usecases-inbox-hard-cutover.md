# 2026-03-31 CLI Assistant-Core Usecases Inbox Hard Cutover

## Goal

- Remove the remaining duplicated headless `packages/cli/src/usecases/**` and `packages/cli/src/inbox-app/**` implementation layers by making CLI import their canonical `@murph/assistant-core` owners directly, while keeping only genuine CLI command/setup/runtime glue in `packages/cli`.

## Scope

- `agent-docs/exec-plans/active/{2026-03-31-cli-assistant-core-usecases-inbox-hard-cutover,COORDINATION_LEDGER}.md`
- `packages/{assistant-core,cli}/{README.md,package.json,src/{commands/**,inbox-app/**,setup-services/**,setup-runtime-env.ts,usecases/**},scripts/verify-package-shape.ts,test/**}`
- `ARCHITECTURE.md`

## Findings

- `packages/cli/src` and `packages/assistant-core/src` still share 38 same-path files after the facade removal.
- Four files are byte-identical duplicates, and the large `usecases/**` plus `inbox-app/**` clusters differ mostly by swapping local relative imports for `@murph/assistant-core/*` imports.
- CLI commands and setup/runtime code still consume the local duplicated copies rather than importing the canonical owner package directly.

## Constraints

- Preserve CLI-owned command routing, setup UX, daemon/client glue, and transport/runtime wrappers.
- Do not make `@murph/assistant-core` depend on `murph`.
- Preserve unrelated dirty-tree edits and the active OpenAI Responses and Vitest concurrency lanes.
- Keep behavioral changes out of scope except where the removal of duplicated ownership requires package-surface cleanup.

## Plan

1. Inventory the remaining duplicated `usecases/**`, `inbox-app/**`, and utility files and classify which ones move fully to assistant-core versus which stay CLI-owned glue.
2. Rewrite CLI sources/tests to import the canonical `@murph/assistant-core` modules directly and delete the now-redundant duplicated CLI implementations.
3. Narrow CLI package shape/tests/docs so the published `murph` package does not preserve the removed duplicate layer as compatibility surface.
4. Run focused and package-level verification, then complete the required audit passes and commit with `scripts/finish-task`.

## Verification

- `pnpm --dir packages/cli typecheck` ✅
- `pnpm typecheck` ✅
- `pnpm exec tsx packages/cli/scripts/verify-package-shape.ts` ✅
- `pnpm build:test-runtime:prepared` ✅
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-core-facades.test.ts --no-coverage` ✅
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-core-facades.test.ts packages/cli/test/canonical-write-lock.test.ts packages/cli/test/cli-expansion-export-intake.test.ts packages/cli/test/health-descriptors.test.ts packages/cli/test/record-mutations.test.ts packages/cli/test/setup-cli.test.ts packages/cli/test/vault-usecase-helpers.test.ts --no-coverage` ✅
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/assistant-core-facades.test.ts packages/cli/test/canonical-write-lock.test.ts --no-coverage` ✅
- `pnpm exec tsx --eval "(async () => { const mod = await import('./packages/cli/src/index.ts'); console.log(JSON.stringify(Object.keys(mod).sort())); })();"` ✅
- `pnpm --dir packages/cli test` ⚠️ fails only in the pre-existing `packages/cli/test/assistant-cron.test.ts` session-id/failure-count assertions. A temporary `cli-expansion-document-meal` failure during one earlier run was caused by racing root `pnpm typecheck` against package tests; the serial rerun cleared that cutover surface and returned to the same known cron-only failure pair.
- Required audits: `simplify` ✅, `task-finish-review` ✅. The simplify pass found one low-value local shim (`packages/cli/src/commands/event-command-helpers.ts`), which was removed. The final review also noted a possible `@murph/assistantd/client` prepared-runtime smoke gap, but that sits in an overlapping dirty `packages/assistantd` lane outside this cutover scope and was left untouched.

## Outcome

- Completed. CLI now imports the canonical `@murph/assistant-core` owner directly for the duplicated `usecases/**`, `inbox-app/**`, setup/runtime-helper, and query-record helper layers, leaving only CLI command/setup orchestration plus the daemon-aware assistant wrappers in `packages/cli`.

Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
