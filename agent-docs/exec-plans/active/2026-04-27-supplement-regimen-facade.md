# Treat supplement as a typed regimen facade

Status: focused_verified_uncommitted
Created: 2026-04-27
Updated: 2026-04-27

## Goal

- Treat `supplement` as a typed CLI/query facade over regimen storage instead of a separate core write-service family.
- Preserve the supplement noun for operators while routing writes through regimen mutations.

## Success criteria

- `supplement save` and `supplement stop` call the regimen service methods with `kind: "supplement"` / default supplement group semantics.
- `supplement save` and `supplement stop` remain; greenfield-only duplicate write commands (`supplement scaffold`, `supplement import-json`, `supplement rename`) are removed instead of kept as aliases.
- Supplement-specific core service methods are removed from the CLI manifest/type surface unless a real semantic read model requires them.
- Focused CLI/service tests cover the regimen delegation behavior.

## Scope

- In scope: `packages/cli`, `packages/vault-usecases`, direct tests, e2e smoke scenario manifests for removed commands, generated CLI metadata when required.
- Out of scope: canonical regimen storage semantics, supplement query compound rollups, Health Commons supplement content.

## Constraints

- Technical constraints: keep package dependencies one-way, preserve public CLI command names, and use existing regimen service/core APIs.
- Product/process constraints: preserve unrelated dirty work and avoid exposing local identifiers in generated files or handoff.

## Risks and mitigations

1. Risk: stale tests or manifest entries keep advertising duplicate supplement write methods.
   Mitigation: run residue searches for removed method names and focused CLI tests.
2. Risk: greenfield hard cut leaves stale command metadata for removed supplement commands.
   Mitigation: remove manifest/scenario/generated command entries and run scenario integrity plus residue searches.

## Tasks

1. Inspect supplement command/service/manifest wiring.
2. Rewire remaining supplement command handlers to regimen methods.
3. Remove duplicate supplement service declarations and removed command metadata.
4. Update tests and generated CLI metadata if required.
5. Run focused verification, typecheck, and direct residue checks.

## Decisions

- Supplement compound list/show remain supplement-specific because they are semantic read rollups over filtered regimen records.
- `supplement import-json` is removed rather than retained as a regimen import alias because this repo is greenfield.
- `supplement stop` passes `group: "supplement"` through the usecase adapter into `core.stopRegimen` so the facade stays scoped to supplement regimen records.

## Verification

- Commands to run: `pnpm typecheck`; `bash scripts/workspace-verify.sh test:diff <touched paths>` or package-local CLI/vault-usecases coverage when more truthful; `pnpm test:smoke`; `git diff --check`; residue searches.
- Passing focused checks:
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/supplement-protocol-typed-save.test.ts packages/cli/test/supplement-wearables-coverage.test.ts packages/cli/test/health-command-coverage.test.ts packages/cli/test/cli-typed-agent-inputs-schema.test.ts`
  - `pnpm --dir packages/vault-usecases exec vitest run --config vitest.config.ts --no-coverage test/health-registry-seams.test.ts`
  - `pnpm test:smoke`
  - `pnpm --dir packages/vault-usecases typecheck`
  - `git diff --check` on touched files
  - Removed-command/service residue scan, with matches only in negative manifest assertions.
- Blocked/unrelated:
  - `pnpm --dir packages/cli typecheck` still fails on the existing food auto-log hard-cut row (`autoLogDaily`, `foodAutoLog`, `autoLogDailyTime`).
  - Earlier broad workspace `typecheck`, `test`, and `test:diff` attempts also failed on unrelated scheduled-log/food auto-log work outside this lane.
