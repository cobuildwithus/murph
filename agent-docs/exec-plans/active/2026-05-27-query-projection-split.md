# Split query projection stores behind facade

Status: active
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Split `packages/query/src/query-projection.ts` into small projection modules while keeping `query-projection.ts` as the public facade for the existing runtime methods.
- Preserve behavior for projection schema/migrations, freshness, rebuild, entity storage, search, metric points, wearable summaries, provider-scope materialization, and JSON decoding.

## Success criteria

- `query-projection.ts` delegates to focused modules under `packages/query/src/projection/`.
- Existing public exports and callers keep working without package export changes.
- Projection rebuild/search/read behavior remains covered by focused query tests plus repo-required typecheck/smoke checks.

## Scope

- In scope: behavior-preserving module extraction for query projection internals, plus any import/test updates needed by the split.
- Out of scope: changing projection schema, SQLite persistence semantics, query visibility, or tolerant-read cache behavior.

## Constraints

- Technical constraints: keep `.runtime/projections/query.sqlite` rebuildable and read-only relative to canonical vault writes; do not add persisted state; preserve existing migration/user-version behavior.
- Product/process constraints: do not expose raw health payloads, local paths, secrets, direct identifiers, or private vault contents in code/docs/logging/tests.

## Risks and mitigations

1. Risk: moving table/storage code changes rebuild behavior accidentally.
   Mitigation: keep extracted functions close to existing code and run query projection/search/provider-scope tests.
2. Risk: overlapping active query plans also name `query-projection.ts`.
   Mitigation: keep this refactor facade-compatible and avoid changing tolerant-read behavior or provider-scope semantics beyond relocation.

## Tasks

1. Inspect current imports, exports, and query-projection tests.
2. Extract schema/freshness/rebuild/store/provider modules under `packages/query/src/projection/`.
3. Convert `query-projection.ts` into a facade and preserve existing public surface.
4. Run focused query tests, `pnpm typecheck`, and `pnpm test:smoke`.
5. Run required completion audits and close the plan through `scripts/finish-task`.

## Decisions

- Keep module names aligned with the requested split: `schema`, `freshness`, `rebuild`, `entity-store`, `search-store`, `metric-store`, `wearable-summary-store`, and `provider-scope`.

## Verification

- Commands to run:
  - `pnpm --dir packages/query test -- --run test/query-projection-provider-scope.test.ts test/vault-reader.test.ts test/query.test.ts`
  - `pnpm typecheck`
  - `pnpm test:smoke`
  - coverage-bearing `pnpm test:diff` or package coverage as required by workflow
- Expected outcomes: all pass or any unrelated pre-existing failure is isolated and reported.
