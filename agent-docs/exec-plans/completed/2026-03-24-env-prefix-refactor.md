# Env Prefix Refactor

## Goal

Make unprefixed environment variable names the primary public contract across the active runtime surfaces while preserving the existing `HEALTHYBOB_*` names as backward-compatible aliases.

## Scope

- Update hosted `apps/web` env loading, examples, and operator-facing errors to prefer unprefixed names.
- Update local device-sync/runtime-state/CLI/web env resolution to prefer unprefixed names and continue accepting legacy aliases.
- Update setup/runtime messaging, tests, and current docs to present the unprefixed names as primary.
- Cover parser/toolchain env lookups that currently expose only `HEALTHYBOB_*` command/model overrides.

## Constraints

- Do not ship a breaking env-contract removal in this pass; old `HEALTHYBOB_*` names must still work.
- Preserve existing precedence where an explicit runtime value beats environment lookup and primary unprefixed names beat legacy aliases.
- Avoid editing immutable historical plan snapshots under `agent-docs/exec-plans/completed/`.
- Preserve unrelated in-flight work already present in the active worktree.

## Verification Plan

- Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
- Run the completion-workflow audit passes: `simplify`, `test-coverage-audit`, `task-finish-review`.
- If broader failures remain, record whether they are pre-existing or caused by this lane before handoff.

## Status

Complete. The runtime/doc refactor now prefers unprefixed env names while retaining `HEALTHYBOB_*` aliases, and focused compatibility tests cover the legacy fallback paths in the hosted env loader, runtime-state resolver, local web vault loader, and device-sync daemon env loader.

Verification summary:

- `pnpm typecheck` passed.
- `pnpm test` passed on the final rerun after one unrelated flaky `packages/cli/test/search-runtime.test.ts` artifact-rebuild failure; a targeted rerun of that test passed.
- `pnpm test:coverage` did not complete cleanly for repo-wide reasons outside this lane:
  - one run reached the smoke/doc guard and failed on pre-existing undocumented `vault-cli supplement ...` scenario coverage unrelated to this env-contract diff;
  - a later rerun failed during root Vitest coverage with `ENOENT ... coverage/.tmp/coverage-4.json`, indicating a coverage-tempdir/runtime issue rather than an env-contract regression.
Status: completed
Updated: 2026-03-24
Completed: 2026-03-24
