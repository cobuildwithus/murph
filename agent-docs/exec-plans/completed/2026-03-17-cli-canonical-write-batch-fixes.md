# CLI canonical write batch fixes

Status: completed
Created: 2026-03-17
Updated: 2026-03-17

## Goal

- Remove direct canonical vault `writeFile`/`appendFile`/`rm` usage from the affected CLI experiment/journal/provider flows and move those writes behind core-owned batched mutation APIs with rollback semantics.

## Success criteria

- The affected CLI use-cases no longer mutate canonical vault files directly.
- Vault summary updates write `vault.json` and `CORE.md` in one logical core batch.
- Experiment lifecycle events roll back the experiment markdown change if the ledger append fails.
- Provider slug renames do not leave duplicate provider docs after a partial failure.
- Focused regression tests cover the reported desynchronization cases.

## Scope

- In scope:
- `packages/cli/src/usecases/experiment-journal-vault.ts`
- `packages/cli/src/usecases/provider-event.ts`
- `packages/core/src/public-mutations.ts`
- `packages/core/src/index.ts`
- targeted CLI/core regression tests
- this execution plan and the coordination ledger while the lane is active
- Out of scope:
- unrelated CLI command routing
- raw/import mutation paths already owned by core
- non-canonical assistant or runtime-state writes

## Constraints

- Keep canonical writes inside `@healthybob/core`.
- Use `runCanonicalWrite` / `WriteBatch` semantics for multi-file or multi-action logical mutations.
- Preserve existing command outputs and validation behavior unless tests require a narrow change.
- Work safely on top of the already-dirty tree without reverting unrelated edits.

## Risks and mitigations

1. Risk: adding overly generic core APIs could widen the public surface without a stable contract.
   Mitigation: keep the new APIs narrowly scoped to the concrete experiment/journal/provider flows the CLI already exposes.
2. Risk: rollback tests may be brittle if they depend on OS-level failures.
   Mitigation: inject failures in a deterministic way by stubbing the batch commit path inside focused tests.

## Tasks

1. Add core public mutation helpers for experiment/journal/provider batch updates.
2. Rewire CLI use-cases to call those helpers and remove direct canonical fs writes/removes/appends.
3. Add regression tests for vault summary sync, lifecycle rollback, and provider slug rename rollback.
4. Run required audits/checks, then commit only the scoped files.

## Verification

- Commands to run:
- `pnpm exec vitest run packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts packages/cli/test/cli-expansion-provider-event-samples.test.ts --no-coverage --maxWorkers 1`
- `pnpm exec vitest run packages/core/test/core.test.ts --no-coverage --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Completed: 2026-03-17
