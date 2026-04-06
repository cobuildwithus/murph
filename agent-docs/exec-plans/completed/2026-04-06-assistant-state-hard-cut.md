# Hard-cut assistant-state into canonical memory, canonical automation, and vault runtime assistant ops

Status: completed
Created: 2026-04-06
Updated: 2026-04-06

## Goal

- Remove `assistant-state/` as a sibling durable store and replace it with:
  - canonical `memory` records under `vault/**`
  - canonical `automation` records under `vault/**`
  - assistant runtime residue under `vault/.runtime/operations/assistant/**`
- Remove the schema-less assistant state CRUD surface and the old assistant-owned memory/cron product model.

## Success criteria

- No user-facing or queryable assistant data remains outside `vault/**` other than explicit `derived/**`.
- `assistant-state/` no longer exists as an active storage root in runtime-state, packaging, hosted snapshots, or assistant code.
- Durable assistant memory is canonical and queryable through a first-class `memory` noun.
- User-configured scheduled assistant prompts are canonical and queryable through a first-class `automation` noun.
- Assistant runtime/session/outbox/receipt/diagnostic state lives under `vault/.runtime/operations/assistant/**` with explicit portable vs machine-local classification.
- The generic assistant state CRUD and durable daily-memory/file editing surfaces are removed.
- Command/docs/contracts are updated to the hard-cut public surface.
- Verification covers typecheck, focused tests, and at least one direct scenario check for hosted/runtime portability and one product-surface check for canonical memory/automation behavior.

## Scope

- In scope:
  - `packages/runtime-state/**`
  - `packages/assistant-core/**`
  - `packages/assistant-cli/**`
  - `packages/core/**`
  - `packages/query/**`
  - `packages/contracts/**`
  - `packages/cli/**`
  - `packages/setup-cli/**`
  - relevant docs/tests/scripts
- Out of scope:
  - device-sync storage refactors
  - unrelated hosted storage reader cleanup
  - migration support for existing assistant-state data

## Constraints

- Hard cut only; no legacy read support or migration shims for existing users.
- Preserve unrelated dirty worktree edits.
- Keep the end-state simpler than the current model; do not recreate assistant-owned product stores under new names.
- New durable JSON runtime state must keep explicit schema/schemaVersion seams.
- Canonical state must remain writable only through owning core paths.

## Risks and mitigations

1. Risk: Splitting memory/automation/runtime across packages produces a sprawling diff with duplicated concepts.
   Mitigation: Reuse existing bank/query/command-noun patterns and delete old assistant-only surfaces instead of wrapping them.
2. Risk: Hosted continuity breaks if assistant runtime portability is under-classified.
   Mitigation: Explicitly classify assistant runtime subpaths and add hosted snapshot tests plus direct scenario proof.
3. Risk: Architectural docs drift from the hard cut.
   Mitigation: Update architecture/contracts/command docs in the same change.

## Workstreams

1. Canonical `memory`
   - add contracts/core/query/CLI ownership for memory records
   - replace assistant memory prompt/search plumbing with canonical reads
   - delete assistant memory files and daily memory
2. Canonical `automation`
   - add contracts/core/query/CLI ownership for automation records
   - move user-configured prompt jobs to canonical records
   - keep run history and execution state runtime-only
3. Runtime cutover
   - move assistant runtime paths under `vault/.runtime/operations/assistant/**`
   - remove sibling assistant-state path resolution and packaging
   - classify portable vs machine-local assistant runtime paths
4. Surface/docs cleanup
   - hard-cut command surface to `memory`, `automation`, and runtime-only `assistant`
   - remove assistant state CRUD and memory-file editing
   - update architecture/contracts/docs/tests

## Verification

- Completed commands:
  - `pnpm --dir packages/runtime-state build`
  - `pnpm --dir packages/contracts build`
  - `pnpm --dir packages/core build`
  - `pnpm --dir packages/query build`
  - `pnpm --dir packages/assistant-core build`
  - `pnpm --dir packages/assistant-cli build`
  - `pnpm --dir packages/cli build`
  - `pnpm --dir packages/assistant-core exec tsc -p tsconfig.json --noEmit --pretty false`
  - `pnpm --dir packages/assistant-cli exec tsc -p tsconfig.typecheck.json --pretty false`
  - `pnpm --dir packages/cli exec tsc -p tsconfig.typecheck.json --pretty false`
  - `pnpm --dir packages/runtime-state test`
  - `pnpm --dir packages/assistant-runtime test`
  - `pnpm --dir packages/assistantd test`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/assistant-runtime-state-service.test.ts test/assistant-daemon-client.test.ts test/assistant-cli.test.ts --no-coverage`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/setup-cli.test.ts test/assistant-cron.test.ts --no-coverage`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/assistant-provider.test.ts test/incur-smoke.test.ts --no-coverage`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/assistant-state.test.ts test/release-script-coverage-audit.test.ts --no-coverage`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/assistant-service.test.ts test/assistant-runtime.test.ts --no-coverage`
  - `pnpm --dir packages/assistantd exec vitest run test/http.test.ts --no-coverage`
  - `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/assistant-daemon-client.test.ts --no-coverage`

## Notes

- This task is explicitly large enough to require a `simplify` audit before the final review pass.
- No separate canonical settings noun is planned for this hard cut.
- Canonical durable assistant memory remains one file at `bank/memory.md`.
Completed: 2026-04-06
