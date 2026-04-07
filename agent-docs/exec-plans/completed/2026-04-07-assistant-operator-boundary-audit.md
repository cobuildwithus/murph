## Goal

Land the current assistant/operator-config boundary hard-cut safely on the live tree by keeping `packages/assistant-runtime/src` on explicit `@murphai/operator-config/*` owner subpaths, removing the remaining duplicate assistant provider-config implementation from `packages/assistant-engine`, and tightening package export surfaces only where the current repo no longer has real non-test consumers.

## Constraints

- Preserve unrelated worktree edits, including the existing coordination-ledger change for the gateway-local lane.
- Treat the supplied patch as intent, not overwrite authority; adapt it to the current package layout where `vault-inbox` owner seams have already been absorbed into `assistant-engine`.
- Do not remove package exports that still have real source/runtime consumers in the current tree.
- Keep assistant-runtime on explicit operator-config subpaths and fail closed on future root-import regressions.

## Files

- `packages/assistant-runtime/src/**`
- `packages/assistant-engine/src/assistant/provider-config.ts`
- `packages/{assistant-cli,assistant-engine,operator-config}/package.json`
- `scripts/verify-workspace-boundaries.mjs`
- `packages/assistant-runtime/test/assistant-core-boundary.test.ts`
- `packages/cli/test/assistant-core-facades.test.ts`
- `packages/assistant-runtime/README.md`
- `ARCHITECTURE.md`

## Verification

- Planned: `pnpm typecheck`
- Planned: `pnpm test:coverage`
- Planned direct checks: `node scripts/check-workspace-package-cycles.mjs`, `node scripts/verify-workspace-boundaries.mjs`

## Notes

- The current repo still has real non-test consumers for `@murphai/assistant-engine/commands/query-record-command-helpers`, so any wildcard-pruning pass must retain that explicit command export.
- The current repo has no `packages/vault-inbox` package; adapt any old patch references to the equivalent `assistant-engine` owner surfaces.
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
