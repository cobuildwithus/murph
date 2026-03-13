# Usecases layer extraction

Status: completed
Created: 2026-03-13
Updated: 2026-03-13

## Goal

- Finish the missing app-layer portion of the health-entity refactor by extracting CLI-owned orchestration into internal `packages/cli/src/usecases/**` modules that consume the existing shared entity definitions and leave `packages/cli` thinner without adding a new workspace package.

## Success criteria

- Internal CLI `usecases/` modules own generic health read/write orchestration plus the explicit document/meal/profile/experiment use cases that currently live in `packages/cli/src/vault-cli-services.ts`.
- `packages/cli/src/vault-cli-services.ts` becomes primarily runtime loading and adapter wiring rather than the home of generic health orchestration.
- `packages/cli/src/health-cli-descriptors.ts` and related method typing consume shared usecase metadata instead of duplicating the core/query service wiring locally.
- Architecture and verification docs reflect the thinner CLI app layer truthfully, without claiming a new package exists.

## Scope

- In scope:
- `packages/cli/src/usecases/**`
- `packages/cli/src/vault-cli-services.ts`
- `packages/cli/src/health-cli-descriptors.ts`
- `packages/cli/src/health-cli-method-types.ts`
- `packages/cli/src/index.ts`
- `ARCHITECTURE.md`
- `agent-docs/index.md`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`
- focused tests under `packages/cli/test/**`
- coordination/plan metadata for this task
- Out of scope:
- command-surface text/UX rewrites in the individual CLI command modules
- core entity-specific storage logic beyond consumption through existing runtime adapters
- inbox CLI/runtime refactors

## Constraints

- Work on top of the current overlapping CLI/query lanes without reverting adjacent edits.
- Preserve current command behavior and result payload shapes.
- Keep `packages/contracts/src/health-entities.ts` as the entity-definition source of truth unless a narrowly scoped extension is required.
- Run completion-workflow audit passes because this changes production runtime code, even though it stays inside `packages/cli`.

## Risks and mitigations

1. Risk: extracting orchestration into internal CLI modules could still create awkward dependency edges or type sprawl.
   Mitigation: keep `src/usecases/**` adapter-driven and depend only on stable contracts/runtime method types, not on command modules.
2. Risk: the current tree has active, overlapping edits in `packages/cli/src/vault-cli-services.ts`.
   Mitigation: preserve current behavior, read the live file state before each patch, and keep the row notes explicit about overlap.
3. Risk: moving logic without updating docs would leave the architecture misleading about where app orchestration lives.
   Mitigation: update architecture docs in the same change.

## Tasks

1. Add internal `packages/cli/src/usecases/**` modules with shared health/usecase definitions and adapter-driven orchestration.
2. Refactor CLI descriptors and `vault-cli-services.ts` to consume those modules.
3. Validate the extracted usecase layer through the existing focused CLI runtime tests that exercise the moved paths.
4. Update docs, run checks and audits, remove the ledger row, and commit only this task’s files.

## Decisions

- Reuse the existing `HealthEntityDefinition` data from `packages/contracts` instead of inventing a second entity registry.
- Extract orchestration first; do not force a simultaneous rewrite of core’s entity-specific storage files.
- Keep special-case flows like regimen stop and current-profile rebuild as explicit internal CLI use cases rather than over-generalizing them.

## Outcome

- Added internal `packages/cli/src/usecases/{types,runtime,shared,health-services,integrated-services}.ts` modules to own CLI application orchestration.
- Reduced `packages/cli/src/vault-cli-services.ts` to a thin re-export surface over the internal usecase modules.
- Kept the shared health-entity contract as the source of truth for scaffold payloads and canonical list-kind normalization in the generic read layer.
- Updated `ARCHITECTURE.md` to describe the thinner CLI layer truthfully.
- Focused verification passed:
  - `pnpm exec vitest run packages/cli/test/health-tail.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/runtime.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/cli/test/inbox-cli.test.ts --no-coverage --maxWorkers 1`
  - `pnpm --dir packages/contracts build >/tmp/contracts-build.log && pnpm --dir packages/runtime-state build >/tmp/runtime-state-build.log && pnpm exec tsc -p packages/cli/tsconfig.typecheck.json --pretty false`
- Required repo checks still fail for pre-existing unrelated issues:
  - `pnpm typecheck` fails in `packages/contracts/scripts/{generate-json-schema.ts,verify.ts}` resolving `@healthybob/contracts/schemas`.
  - `pnpm test` and `pnpm test:coverage` fail in `packages/cli/scripts/verify-package-shape.ts` because `packages/cli/test/canonical-write-lock.test.ts` still imports another package's `src` tree.
Completed: 2026-03-13
