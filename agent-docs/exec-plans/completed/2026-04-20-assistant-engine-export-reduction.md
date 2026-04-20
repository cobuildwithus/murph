## Goal

Reduce `@murphai/assistant-engine` file-shaped `./assistant/*` public entrypoints by hard-cutting unused implementation-shaped exports, rerouting any remaining external test callers to semantic top-level assistant-engine seams, and adding a workspace-boundary guard that rejects new implementation-shaped assistant-engine exports unless they are explicitly allowlisted.

## Scope

- `packages/assistant-engine/package.json`
- `packages/assistant-engine/src/{assistant-automation,assistant-cron,assistant-provider,assistant-runtime,assistant-state,assistant-store}.ts`
- `packages/assistant-engine/test/assistant-wrapper-exports.test.ts`
- External caller updates under `packages/cli/test/**` only when they currently import `@murphai/assistant-engine/assistant/*`
- `tsconfig.base.json` if the dedicated `@murphai/assistant-engine/assistant/*` path alias becomes stale
- `scripts/workspace-boundaries/package-export-rules.mjs`
- `scripts/workspace-boundaries/package-export-rules.test.ts`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Constraints

- Preserve unrelated dirty-tree edits, especially the active `assistant-engine` capability-definition refactor and the in-flight workspace-boundary split work.
- Keep runtime/product behavior unchanged; this is an export-shape cleanup plus test import rerouting only.
- Prefer semantic assistant-engine wrappers over reviving new file-shaped compatibility exports.
- Keep the workspace-boundary guard narrow to assistant-engine implementation-shaped export keys with an explicit allowlist seam.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/package.json packages/assistant-engine/src/assistant-automation.ts packages/assistant-engine/src/assistant-cron.ts packages/assistant-engine/src/assistant-provider.ts packages/assistant-engine/src/assistant-runtime.ts packages/assistant-engine/src/assistant-state.ts packages/assistant-engine/src/assistant-store.ts packages/assistant-engine/test/assistant-wrapper-exports.test.ts packages/cli/test scripts/workspace-boundaries/package-export-rules.mjs scripts/workspace-boundaries/package-export-rules.test.ts tsconfig.base.json`
- `pnpm --dir packages/assistant-engine test:coverage` and/or `pnpm --dir packages/cli test:coverage` only if the diff-aware lane does not provide truthful owner coverage for the touched owners
