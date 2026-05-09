# Intervention link hardening

Status: completed
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Harden the committed intervention-to-experiment linking surface after final subagent review, without changing the overall architecture or adding broad abstractions.

## Success Criteria

- Explicit `intervention add --experiment` accepts the same lookup forms the usecase already resolves.
- Explicit add and attach do not link mismatched intervention modalities.
- Stale regimen links clear when a user clears regimen state.
- Partial slug-only experiment state can be repaired without requiring `--replace` for the same experiment.
- Focused tests, typecheck, and diff verification pass.

## Scope

- `packages/vault-usecases/src/usecases/intervention-experiment-link.ts`
- `packages/vault-usecases/src/usecases/intervention.ts`
- `packages/cli/src/commands/intervention.ts`
- Focused CLI tests and generated CLI metadata/docs as needed.

## Tasks

1. Apply narrow usecase validation and link-preservation fixes.
2. Update CLI option schema/docs/generated metadata for experiment lookup.
3. Add focused regression tests for review findings.
4. Run verification and commit the scoped follow-up.

## Verification

- `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts --no-coverage test/cli-expansion-intervention.test.ts`
- `pnpm --filter @murphai/vault-usecases typecheck && pnpm --filter @murphai/murph typecheck`
- `pnpm typecheck`
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/container-entrypoint.test.ts -t "rejects a first run bearer token when no startup control token exists"`
- `pnpm test:diff`
Completed: 2026-05-09
