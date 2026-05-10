# Saved Entity Write Receipts

Status: completed
Created: 2026-05-10
Updated: 2026-05-10

## Goal

- Return compact saved entity data from regimen-backed typed write commands so assistants can confirm writes from authoritative output instead of sparse ids.

## Success criteria

- `supplement save` returns existing top-level receipt fields plus compact `entity` without `markdown`.
- Typed `regimen save` returns existing top-level receipt fields plus compact `entity` without changing `regimen import-json`.
- Regimen/supplement read mapping is shared between query read surfaces and save receipts without making CLI import private mappers.
- Focused tests cover runtime output, preserved supplement product fields on update, and output schema exposure.

## Scope

- In scope:
  - Compact saved entity contract in operator CLI contracts.
  - Regimen/supplement read entity mapper extraction inside vault-usecases.
  - Behavior-level vault-usecases save services for typed supplement/regimen saves.
  - CLI typed save commands and focused tests.
- Out of scope:
  - Broad migration of all save/upsert commands.
  - Prompt behavior changes unless required after receipt data exists.
  - Automatic post-write `show` orchestration.

## Constraints

- Technical constraints:
  - Preserve existing top-level write receipt fields.
  - Do not return full markdown body from write receipts.
  - Keep `regimen import-json` sparse in this slice.
  - Keep package boundaries one-way and use public package entrypoints only.
- Product/process constraints:
  - Preserve privacy guardrails and avoid logging or exposing sensitive health content beyond command output requested by the operator.

## Risks and mitigations

1. Risk: Accidentally changing `regimen import-json` output because it shares the current save schema.
   Mitigation: Split typed `regimen save` output schema from import-json schema.
2. Risk: Duplicating read/write projection logic.
   Mitigation: Extract regimen/supplement entity mapping into a private vault-usecases module used by both query services and save services.
3. Risk: Exposing markdown or body content in mutation receipts.
   Mitigation: Use a snapshot schema derived from `readEntitySchema` with `markdown` omitted.

## Tasks

1. Add compact saved entity contract.
2. Extract and reuse regimen/supplement entity mappers.
3. Add behavior-level typed save services in vault-usecases.
4. Update typed CLI save commands and schemas.
5. Add focused tests and run scoped verification.
6. Run required completion audits and close the plan.

## Decisions

- Use `readEntitySchema.omit({ markdown: true })` instead of `listEntitySchema`.
- Keep `occurredAt: null` for regimen/supplement records whose source date is date-only `startedOn`; preserve `startedOn` in `entity.data`.
- Keep `regimen import-json` output unchanged for this slice.

## Verification

- Passed:
  - `pnpm --filter @murphai/operator-config build`
  - `pnpm --filter @murphai/vault-usecases build`
  - `pnpm --dir packages/cli build`
  - `pnpm --dir packages/operator-config typecheck`
  - `pnpm --dir packages/vault-usecases typecheck`
  - `pnpm --dir packages/vault-usecases test`
  - `pnpm --dir packages/operator-config exec vitest run --config vitest.config.ts --no-coverage test/vault-cli-contracts.test.ts`
  - `pnpm exec tsc --noEmit --pretty false --project packages/cli/tsconfig.json`
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/supplement-save-typed-parity.test.ts packages/cli/test/protocol-save-typed-parity.test.ts`
  - Built CLI schema check confirmed typed saves expose `entity` and `regimen import-json` does not.
- Blocked by unrelated pre-existing failures:
  - `pnpm typecheck` fails in dirty Cloudflare runner work on missing `HostedMailboxLane`.
  - `pnpm test:diff <changed paths>` reaches an existing CLI inbox mock type error missing `getAttachment`.
Completed: 2026-05-10
