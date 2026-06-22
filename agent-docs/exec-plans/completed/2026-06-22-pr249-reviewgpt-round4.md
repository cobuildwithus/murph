# PR 249 ReviewGPT Round 4 Follow-Up

## Goal

Resolve accepted ReviewGPT round 4 findings on PR 249 before handoff.

Success criteria:

- Existing format-v1 vaults without `ledger/integration-ingests` still validate.
- Provider-imported workout and measurement events keep raw evidence refs needed by manifest commands.
- Accepted fixes have focused regression coverage and repo-required verification.
- Changes are committed, pushed, and re-reviewed.

## Scope

- `packages/contracts/src/vault-families.ts`
- `packages/contracts/test/vault-layout-validation.test.ts`
- `packages/core/src/mutations.ts`
- `packages/core/src/vault.ts`
- Focused core/vault-usecases tests for device import compatibility, family registry behavior, and manifest lookup
- Review artifacts under `audit-packages/`

## Notes

- Preserve existing vault data and keep `CURRENT_VAULT_FORMAT_VERSION` at `1`.
- Do not introduce a startup migration.
- Treat the ReviewGPT journal-collapse suggestion as actionable only if it identifies a correctness or bounded-performance bug in the current required design.
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
