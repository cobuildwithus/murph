# Remove dead vault-upgrade seam

Status: completed
Created: 2026-04-09
Updated: 2026-04-09

## Goal

- Land the downloaded Pro patch intent that removes the unused `vault upgrade` compatibility seam.
- Keep the change deletion-first while leaving current-format fail-closed validation intact.

## Success criteria

- The `vault upgrade` CLI/usecase/core path is removed end-to-end.
- Vault metadata validation uses one unsupported-format failure for any non-current `formatVersion`.
- Audit/action enums, docs, and focused tests match the new single-path behavior.
- The repo passes truthful verification for the touched owners or reports only unrelated blockers.

## Scope

- In scope:
  - `ARCHITECTURE.md`
  - `docs/architecture.md`
  - `packages/contracts/**`
  - `packages/core/**`
  - `packages/operator-config/src/vault-cli-contracts.ts`
  - `packages/vault-usecases/src/usecases/**`
  - `packages/cli/src/**`
  - focused tests under `packages/contracts/test`, `packages/core/test`, `packages/query/test`, `packages/vault-usecases/test`, `packages/cli/test`
- Out of scope:
  - historical changelog or release-note cleanup
  - completed execution plans
  - broader compatibility removals outside the dead `vault upgrade` seam

## Current state

- The downloaded patch cleanly matches the current production files for the `vault upgrade` removal.
- Current tests and helper mappings still reference the old split between `VAULT_UPGRADE_REQUIRED` and `VAULT_UPGRADE_UNSUPPORTED`.
- Current docs still describe a reserved upgrade seam that no longer needs to exist after this cut.

## Plan

1. Remove the `vault upgrade` production path from contracts, core, usecases, CLI wiring, and docs.
2. Update focused tests and CLI error mappings to the single unsupported-format behavior required by that removal.
3. Run truthful verification for the touched owners, then complete the required review workflow and scoped commit.

## Risks and mitigations

1. Risk: leaving a partial public surface behind in CLI/type contracts.
   Mitigation: remove the command, schemas, manifest bindings, exported core symbol, and usecase interface together.
2. Risk: stale tests still expecting the old error split.
   Mitigation: update focused tests in the same pass to assert the new fail-closed behavior.
3. Risk: touching files with unrelated worktree edits.
   Mitigation: stay on the bounded file list above and preserve all unrelated modifications.

## Verification

- Expected truthful lane:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff ARCHITECTURE.md docs/architecture.md packages/contracts/src/vault.ts packages/contracts/src/constants.ts packages/contracts/generated/audit-record.schema.json packages/contracts/test/vault-layout-validation.test.ts packages/core/README.md packages/core/src/index.ts packages/core/src/public-mutations.ts packages/core/src/vault-upgrade.ts packages/core/test/vault-upgrade.test.ts packages/operator-config/src/vault-cli-contracts.ts packages/vault-usecases/src/usecases/integrated-services.ts packages/vault-usecases/src/usecases/types.ts packages/vault-usecases/src/usecases/vault-usecase-helpers.ts packages/vault-usecases/test/helpers-public-seams.test.ts packages/cli/src/commands/vault.ts packages/cli/src/incur.generated.ts packages/cli/src/vault-cli-command-manifest.ts packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts packages/query/test/query.test.ts`
Completed: 2026-04-09
