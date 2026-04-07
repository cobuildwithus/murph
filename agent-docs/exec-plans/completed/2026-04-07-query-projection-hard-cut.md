# Query Projection Hard Cut

## Goal

Hard-cut local query reads and runtime search onto one query-owned rebuildable projection store under `.runtime/projections/**`, remove the standalone search-db architecture and CLI backend split, and preserve canonical vault files as the only source of truth.

## Why

- `@murphai/query` currently rescans canonical vault files in `readVault()` for many CLI, assistant, and vault-inbox reads.
- Runtime search currently layers a second local SQLite store on top of that scan-first path.
- The long-term simplest architecture is one query-owned local projection store, one strict rebuild path, and one read/search owner.

## Scope

- Query projection store/schema/rebuild/load/status APIs
- Query read and runtime search call paths
- Runtime-state path constants for the new query projection location
- CLI search/index command surface hard cut
- Durable docs and verification docs that describe the new owner seam

## Non-goals

- No change to canonical write ownership in `@murphai/core`
- No attempt to collapse `@murphai/gateway-local` into query storage
- No hosted snapshot inclusion for the new query projection
- No tolerant projection persistence; tolerant reads stay explicit fallback logic only

## Target End State

- One query-owned SQLite file: `.runtime/projections/query.sqlite`
- `readVault()` loads from that projection, rebuilding strictly from canonical files when stale or missing
- runtime search uses that same projection instead of a separate `search.sqlite`
- CLI removes backend selection and search-specific index lifecycle wording in favor of one query projection surface

## Risks / Invariants

- The projection must stay rebuildable and machine-local only.
- The projection must not become a semantic owner distinct from `CanonicalEntity`.
- Strict reads must fail closed on malformed canonical data.
- Tolerant reads must not persist partial/tolerant projection state.
- Existing query selectors must keep the same observable behavior unless explicitly simplified and documented.

## Verification target

- `pnpm typecheck`
- `pnpm test:packages`
- `pnpm test:smoke`
- focused direct proof for query projection rebuild/status/search behavior

## Outcome

- Implemented one query-owned rebuildable projection store at `.runtime/projections/query.sqlite`
- `packages/query` now rebuilds/loads that projection for strict `readVault()` and runtime search
- `readVaultTolerant()` remains the explicit raw-scan fallback and does not persist tolerant state
- CLI hard-cut completed:
  - `search query` no longer exposes `--backend`
  - `search index status|rebuild` removed
  - `query projection status|rebuild` added

## Verification run

- Focused checks passed:
  - `pnpm --dir packages/runtime-state typecheck`
  - `pnpm --dir packages/query typecheck`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/cli typecheck`
  - `pnpm --dir packages/runtime-state exec vitest run test/hosted-bundle.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm --dir packages/query exec vitest run test/query.test.ts --config vitest.config.ts --no-coverage`
  - `pnpm build:test-runtime:prepared`
  - `MURPH_PREPARED_CLI_RUNTIME_ARTIFACTS=1 pnpm --dir packages/cli exec vitest run test/search-runtime.test.ts test/incur-smoke.test.ts --config vitest.workspace.ts --no-coverage`
- Broader repo checks:
  - `pnpm test:smoke` passed
  - `pnpm typecheck` failed in pre-existing unrelated `packages/core` workspace-build errors:
    - `packages/core/src/vault-upgrade.ts`: missing export `buildCurrentVaultMetadataFromLegacy`
    - `packages/core/src/vault.ts`: missing export `loadVaultMetadataWithCompatibility`
  - `pnpm test:packages` failed in pre-existing unrelated `packages/contracts` artifact drift:
    - stale `vault-metadata.schema.json` generated artifact detected by `packages/contracts/dist/scripts/verify.js`

## Planned files

- `packages/query/**`
- `packages/runtime-state/**`
- `packages/cli/**`
- `packages/assistant-engine/src/query-runtime.ts`
- `ARCHITECTURE.md`
- `agent-docs/references/testing-ci-map.md`
Status: completed
Updated: 2026-04-07
Completed: 2026-04-07
