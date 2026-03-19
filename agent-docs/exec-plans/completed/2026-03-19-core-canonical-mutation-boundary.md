# Core Canonical Mutation Boundary

## Goal

Move canonical mutation semantics for experiment, journal, provider, event, vault-summary, and inbox journal/experiment-note promotion flows out of `packages/cli` and into typed `@healthybob/core` APIs without changing the CLI command surface, result envelopes, or observable write behavior.

## Scope

- Add high-level mutation ports in `packages/core` for the moved flows.
- Reuse existing core frontmatter, registry, vault-fs, and canonical write helpers instead of reimplementing mutation mechanics in CLI.
- Rewire `packages/cli/src/usecases/experiment-journal-vault.ts`, `packages/cli/src/usecases/provider-event.ts`, and `packages/cli/src/inbox-services.ts` to validate inputs, orchestrate query-side lookups as needed, call the new core ports, and format existing result shapes.
- Add focused core and CLI tests that prove CLI no longer owns canonical write-batch/frontmatter mutation semantics for the targeted flows.
- Update architecture docs to make core ownership of canonical writes more explicit if the boundary becomes materially clearer.

## Constraints

- Preserve current CLI outputs, command names, and result schemas.
- Do not leave direct canonical markdown/jsonl mutation logic, frontmatter parse/stringify logic, or canonical write-batch assembly in CLI for the targeted write flows.
- Preserve unrelated in-progress edits in the dirty worktree and avoid reverting adjacent changes.
- Follow the required completion workflow and repo verification commands before handoff.

## Verification Plan

- Run completion workflow audit passes after implementation.
- Run `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Outcome

- Added high-level core mutation ports for experiment update/checkpoint/stop, journal append/link/unlink, provider upsert, event upsert, vault summary updates, and inbox journal/experiment-note promotions.
- Rewired the targeted CLI write flows to validate inputs, do query-side lookup/orchestration where needed, call the core mutation ports, and preserve the existing CLI result envelopes.
- Added focused boundary tests in core and CLI plus architecture/docs updates that make the ownership boundary explicit.

## Verification Outcome

- `pnpm test` passed.
- `pnpm test:coverage` passed.
- `pnpm typecheck` still fails in unrelated CLI test files from concurrent setup/inbox cleanup work: `packages/cli/test/inbox-service-boundaries.test.ts` and `packages/cli/test/setup-channels.test.ts`.
Status: completed
Updated: 2026-03-19
Completed: 2026-03-19
