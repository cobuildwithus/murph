Goal (incl. success criteria):
- Implement the Integration Raw Evidence Journal migration plan: device-provider evidence moves from `raw/integrations/**` per-ingest files/manifests to monthly append-only `ledger/integration-ingests/YYYY/YYYY-MM.jsonl` rows.
- Success means v2 normal device imports append exactly one integration-ingest row, no longer write device raw files/manifests or integration `rawRefs`, validation enforces the v2 invariants, v1 vaults have a proof-heavy migration path through copy/detach/prune/finalize, and explicit provenance readers replace device manifest lookup.
- The branch must include focused contract/core/importer/usecase/CLI/docs tests, required verification, completion audits, a scoped commit, PR, and external ReviewGPT PR loop.

Constraints/Assumptions:
- This is high-risk cross-cutting storage/schema work; use the isolated worktree/PR lane and the high-risk completion workflow.
- Existing v1 vaults with `raw/integrations/**` data are real and must remain migratable without data loss.
- Preserve exact retained UTF-8 provider evidence, byte sizes, and SHA-256 hashes; do not refetch provider data or re-run newer normalizers against legacy payloads.
- Keep logs, audit rows, CLI migration summaries, and hosted metadata payload-free: counts, paths only when bounded/local/relative, and blocker codes only.
- Do not add compression, archive indexes, tombstones, content-addressed storage, a migration registry, a canonical index, or dual-write behavior.
- Keep non-device raw families on the existing raw manifest path.

Key decisions:
- Use `formatVersion: 2` as the hard-cut current vault format while retaining one isolated v1 integration-storage migrator.
- The canonical persisted state is a monthly JSONL ingest row with folded receipt metadata, exact evidence parts, logical event evidence roles, optional complete sample IDs for new writes, and metadata-only provenance.
- Event ledger migration rewrites historical rows to remove only `raw/integrations/**` references; it does not append product event revisions.
- Query/browser projection inputs exclude integration-ingest journals; rare provenance reads scan the small journal family explicitly.

State:
- Implementation, docs, required local audits, accepted audit fixes, and verification are complete.

Done:
- Read required repo routing, architecture, invariants, security, reliability, verification, completion, PR review-loop, and testing docs.
- Created isolated worktree `codex/integration-ingest-journal` from `origin/main`.
- Added integration ingest contract schemas/family metadata and switched current vault format to v2.
- Added integration ingest append/read helpers, device import journal writes, v1 raw integration migration, validation guards, usecase/CLI entrypoints, and importer payload changes.
- Preserved legacy wearable cleanup validation by allowing legacy integration raw manifests only inside explicit cleanup/migration paths.
- Coverage-write added focused proof that unknown unmanifested legacy raw integration files block apply without partial migration.
- Security/privacy audit found no medium-or-higher issues.
- Deep-review found and accepted five migration/validation bugs; fixed BOM byte preservation, unsupported format blocking, duplicate legacy import-id blocking, invalid legacy event-row blocking, and complete sample-id output validation. Targeted deep-review rerun found no unresolved accepted/actionable findings.
- Fixed query current-vault fixtures that still hardcoded `formatVersion: 1`; the new v2 contract now rejects v1 outside the explicit migration path.
- Focused verification passed:
  - `pnpm --filter @murphai/importers typecheck`
  - `pnpm --filter @murphai/importers exec vitest run --config vitest.config.ts --no-coverage test/device-providers.test.ts test/device-providers-junction.test.ts test/wearable-evidence.test.ts`
  - `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/core.test.ts test/vault-family-registry.test.ts test/audit-boundary.test.ts test/operations-thresholds.test.ts test/wearable-receipts.test.ts test/wearable-storage-migration.test.ts test/device-import.test.ts test/import-device-batch-validation.test.ts test/integration-ingest-migration.test.ts`
- Post-audit verification passed:
  - `git diff --check`
  - `pnpm --filter @murphai/contracts typecheck`
  - `pnpm --filter @murphai/contracts test:coverage`
  - `pnpm --filter @murphai/core typecheck`
  - `pnpm --filter @murphai/core exec vitest run --config vitest.config.ts --no-coverage test/integration-ingest-migration.test.ts`
  - `pnpm --filter @murphai/core test:coverage`
  - `pnpm --filter @murphai/importers typecheck`
  - `pnpm --filter @murphai/importers test:coverage`
  - `pnpm --filter @murphai/vault-usecases test:coverage`
  - `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts --testNamePattern "vault migrate-integration-storage"`
- Earlier full CLI coverage passed after generating ignored Health Commons catalog files: `pnpm --dir packages/cli test:coverage`.
- Final broad verification passed:
  - `pnpm --filter @murphai/query exec vitest run --config vitest.config.ts --no-coverage test/browser-vault-metric-points-labs-measurements.test.ts --testNamePattern "query projection rebuild stores shared event"`
  - `pnpm --filter @murphai/query test:coverage`
  - `pnpm test:diff`

Now:
- Close the active plan with a scoped commit, push the branch, open a draft PR, then run the external PR ReviewGPT loop.

Next:
- Scoped commit, draft PR, ReviewGPT loop.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: real-vault operator spot check on a copied v1 vault is still recommended before production migration use.
- Historical migrated rows use `sampleIdsComplete: false` unless exact sample IDs are available from legacy data.

Working set (files/ids/commands):
- `packages/contracts/src/constants.ts`
- `packages/contracts/src/integration-ingest.ts`
- `packages/contracts/src/vault-families.ts`
- `packages/core/src/integration-ingests.ts`
- `packages/core/src/integration-ingest-migration.ts`
- `packages/core/src/mutations.ts`
- `packages/core/src/vault.ts`
- `packages/core/src/raw.ts`
- `packages/importers/src/core-port.ts`
- `packages/importers/src/device-providers/import-device-provider-snapshot.ts`
- `packages/query/test/browser-vault-metric-points-labs-measurements.test.ts`
- `packages/query/test/query.test.ts`
- `packages/vault-usecases/**`
- `packages/cli/src/commands/vault.ts`
- `docs/contracts/00-invariants.md`
- `docs/contracts/01-vault-layout.md`
- `docs/contracts/02-record-schemas.md`
- `agent-docs/index.md`
- `ARCHITECTURE.md`
- Verification target: complete; use `pnpm test:diff` result as the final broad gate.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
