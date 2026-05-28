# Align vault-usecases query contract ownership and helper seams

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Stop `packages/vault-usecases` from maintaining a narrower public query-runtime contract than the runtime shape its internal services already consume.
- Keep the public helper seam helper-only, with mutation and service-factory exports staying on the testing seam instead.
- Keep supplement slug normalization owned by the core protocol writer instead of re-implementing it in the composition layer.

## Success criteria

- `src/query-runtime.ts` re-exports owner query model types instead of re-declaring experiment result shapes locally.
- `src/usecases/types.ts` reuses one shared `QueryRuntimeModule` contract instead of patching missing health-query methods back together locally.
- `src/helpers.ts` no longer leaks mutation and service-factory APIs through `src/usecases/shared.ts`.
- supplement rename only forwards an explicit `slug`; default slug derivation remains core-owned.
- Focused `vault-usecases` tests cover the contract/barrel adjustments, required verification passes, and a clean scoped landing.

## Scope

- In scope:
  - `packages/vault-usecases/src/{query-runtime.ts,query-id-families.ts,helpers.ts,testing.ts}`
  - `packages/vault-usecases/src/usecases/{types.ts,shared.ts,explicit-health-family-services.ts,experiment-journal-vault.ts}`
  - directly coupled `packages/vault-usecases/test/{query-runtime,query-helper-coverage,helpers-public-seams,public-entrypoints,health-registry-seams,record-service-coverage}.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-vault-usecases-query-contract-alignment.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - `packages/vault-usecases/src/usecases/runtime.ts` and `packages/vault-usecases/test/runtime.test.ts`, which are already owned by the active loader-seam lane
  - broader loader ownership changes, combined-runtime caching changes, or importers wiring work
  - changes to `@murphai/query` unless the owner exports prove insufficient for the current contract cleanup

## Constraints

- Keep the diff additive in a dirty tree and avoid the active loader-seam lane's scoped files.
- Reuse owner `@murphai/query` types instead of cloning experiment result contracts locally.
- Keep helper/public seam changes behavior-preserving apart from removing the unintended helper-barrel leakage.

## Risks and mitigations

1. Risk: public `helpers` consumers could already rely on the leaked testing exports.
   Mitigation: keep those exports available from `testing.ts`, add explicit public-entrypoint coverage, and limit the helper barrel to helper-oriented symbols only.
2. Risk: the shared query contract could still drift if `types.ts` keeps rebuilding it locally.
   Mitigation: make `types.ts` alias the shared `query-runtime.ts` contract directly.
3. Risk: supplement rename behavior could change if callers relied on the local slugifier.
   Mitigation: preserve explicit `slug` passthrough and add focused coverage that implicit slug selection stays core-owned.

## Tasks

1. Register the query-contract lane in the active ledger with explicit overlap notes.
2. Replace local query-runtime experiment result declarations with owner re-exports and one shared runtime-module type.
3. Remove non-helper re-exports from the helper seam while keeping them on `testing.ts`.
4. Delegate default supplement slug derivation back to the core writer and add focused proof.
5. Run required verification, required audit passes, and land a scoped commit if the shared ledger remains clean enough for `scripts/finish-task`.

## Decisions

- Keep the active loader-seam task isolated by not editing `usecases/runtime.ts` or `test/runtime.test.ts` in this lane.
- Treat `query-runtime.ts` as the single local compatibility seam for owner-derived query types and runtime shape.
- Preserve the overlapped helper split from the active public-runtime-laziness lane because `shared.ts` and the query helper tests already depend on `query-id-families.ts` in the current tree.

## Verification

- Planned commands:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/vault-usecases/src/query-runtime.ts packages/vault-usecases/src/query-id-families.ts packages/vault-usecases/src/helpers.ts packages/vault-usecases/src/testing.ts packages/vault-usecases/src/usecases/types.ts packages/vault-usecases/src/usecases/shared.ts packages/vault-usecases/src/usecases/explicit-health-family-services.ts packages/vault-usecases/src/usecases/experiment-journal-vault.ts packages/vault-usecases/test/query-runtime.test.ts packages/vault-usecases/test/query-helper-coverage.test.ts packages/vault-usecases/test/helpers-public-seams.test.ts packages/vault-usecases/test/public-entrypoints.test.ts packages/vault-usecases/test/health-registry-seams.test.ts packages/vault-usecases/test/record-service-coverage.test.ts`
  - `pnpm test:smoke`
  - package-local focused Vitest coverage if the diff-aware lane is blocked or proves untruthful
- Direct proof:
  - query-runtime compatibility tests that prove the local surface is just the owner runtime
  - helper/public seam tests that prove the helper barrel no longer exports testing-only APIs
  - supplement rename tests that prove implicit slug derivation stays in the core writer
