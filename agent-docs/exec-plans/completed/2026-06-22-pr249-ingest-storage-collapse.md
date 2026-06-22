Goal (incl. success criteria):
- Resolve PR 249 ReviewGPT round 3 storage findings by preserving existing v1 vault availability and keeping provider evidence bytes in existing raw artifacts/manifests instead of monthly ingest journal rows.
- Success means current vault format remains compatible with existing vaults, new device/provider imports retain compact ingest lookup rows that reference raw evidence, destructive migration/replay-only branches are removed or made unnecessary, docs/contracts match the storage model, required verification passes, and the PR ReviewGPT loop reaches zero accepted findings.

Constraints/Assumptions:
- Existing vaults with `formatVersion: 1` and `raw/integrations/**` data must remain readable without an explicit startup migration.
- Imported originals belong under immutable `raw/**` with manifests; `ledger/integration-ingests/**` should stay append-only and compact enough for hot reads.
- Prefer deleting the v2 migration/storage complexity over adding compatibility layers, repair loops, or a second evidence store.
- Preserve unrelated active ledger rows and unrelated working-tree edits.

Key decisions:
- Collapse the current v2 payload journal direction back onto the existing raw-manifest primitive, with the ingest journal acting as an event/import index over raw artifacts.
- Treat ReviewGPT round 3 findings as accepted architecture feedback because they match existing-vault compatibility and hot-file-size invariants.

State:
- Focused verification and required local audits are complete; final scoped verification and PR closeout are in progress.

Done:
- Confirmed PR 249 is open on branch `codex/integration-ingest-journal`.
- Loaded workflow, architecture, contract, verification, security, reliability, and PR ReviewGPT-loop docs.
- Confirmed round 3 findings require changing the current storage direction rather than patching around v2.
- Restored `CURRENT_VAULT_FORMAT_VERSION` to 1 and removed the v2 integration-storage migration command/API/test surface.
- Changed integration-ingest evidence parts to compact raw references (`relativePath`, `byteSize`, `sha256`) and kept exact provider evidence in `raw/integrations/**` with manifests.
- Updated device-batch import, vault validation, hosted canonical receipt replay, contracts, tests, generated schemas, CLI metadata, and docs for the compact-index model.
- Added coverage-audit regressions for hosted receipt append-only text rejection, removed migration command/API absence, and literal v1 compact ingest compatibility.
- Accepted and fixed the deep-review manifest-coupling finding: integration ingest parts must live under `raw/integrations/**` and match a `device_batch` raw manifest owned by the ingest id/provider before validation or JSON parsing succeeds.
- Security/privacy audit reported no findings.
- Focused core typecheck and core/CLI Vitest checks passed after the audit fixes.

Now:
- Run final scoped `pnpm test:diff $(git diff --name-only)`, then commit/push and continue the ReviewGPT loop.

Next:
- Commit with `scripts/finish-task`, push PR 249, and run ReviewGPT until no accepted findings remain.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- PR 249: https://github.com/cobuildwithus/murph/pull/249
- audit-packages/pr-249-round-3.md
- packages/contracts/src/constants.ts
- packages/contracts/src/zod.ts
- packages/core/src/integration-ingests.ts
- packages/core/src/mutations.ts
- packages/core/src/vault.ts
- packages/core/src/operations/write-batch.ts
- packages/assistant-runtime/src/hosted-runtime/workspace-restore.ts
- packages/cli/src/commands/vault.ts
- docs/contracts/**
- pnpm --dir packages/contracts generate
- pnpm --dir packages/cli gen:config-schema
- pnpm --filter @murphai/core typecheck
- pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/device-import.test.ts test/operations-thresholds.test.ts
- pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/canonical-json-input.test.ts packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
