# Replace mocked CLI retrieval coverage with real vault proof

Status: completed
Created: 2026-09-05
Updated: 2026-09-05

## Goal and scope

Replace the fake query-runtime search command suite with stronger proof through
existing CLI processes and temporary canonical vaults. Production code,
dependencies, schemas, and query behavior remain unchanged.

## Protected outcomes and owner

The CLI command registry and public vault-usecases runtime load the real query
owner. Search must select matching records; timeline must honor selected entry
types and filters while omitting internal data; invalid text must fail before
creating a projection. Existing real tests retain date/stream retrieval,
projection lifecycle, canonical invalidation, and inbox SQLite isolation.

## Tasks

1. Remove mocked result/call echo tests after mapping their meaningful contracts.
2. Extend existing real CLI cases with input rejection, real filter exclusion,
   selected timeline results, and bounded output assertions.
3. Run focused retrieval proof, CLI typecheck, complexity, and candidate review.
4. Close the plan and commit only after parent candidate review.

## Risks and decisions

- Keep positive and negative record selections so filter forwarding failures
  cannot hide behind echoed options or constant fake results.
- Reuse existing fixture setup and CLI harness; add no framework or production logic.
- Changelog and Product UX are not applicable: internal test proof only.

## Verification

- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/search-runtime.test.ts`: 15 tests passed after final proof refinement.
- `pnpm --dir packages/cli typecheck`: passed after final TypeScript edit.
- `pnpm complexity:diff`: passed; no authored production JS/TS changes.
- `git diff --check`: passed.
- Frozen install succeeded. Frog inventory reviewed; no new repository friction.
- Parent candidate review passed. CI owns broad exact-head verification.
Completed: 2026-09-05
