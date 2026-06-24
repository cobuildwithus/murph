Goal (incl. success criteria):
- Land the integration-ingest v2 hard cut on a fresh PR branch from current `origin/main`.
- Success means the patch applies cleanly or is reconciled with current main, v2 device evidence journals and migration/provenance behavior are present, obsolete raw-integration paths are removed, generated artifacts are aligned, and required verification/audits pass.

Constraints/Assumptions:
- Keep the architecture simple: no dual writes, compatibility resolver, generic migration framework, tombstone farm, archive index, or nested compression.
- `packages/core` remains the canonical vault mutation owner.
- Device evidence storage changes are high-risk persisted-state work and must fail closed on unresolved references, mismatches, unknown files, symlinks, and conflicting manifests/journal rows.
- Completion review fixes must stay narrow invariant corrections; do not add an ingest index, compatibility resolver, chunking framework, or broader migration framework in this landing.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Use the supplied patch as implementation intent, then verify from scratch against current `origin/main`.
- Keep the landing in an isolated worktree/branch named `codex/land-integration-ingest-hard-cut`.
- Accepted review findings are handled with simple primitives: vault-wide device externalRef reconciliation, a higher evidence-part count under the existing byte cap, bounded migration detection, raw-aware legacy prune deletes, and fail-closed non-evidence legacy rawRef blockers.
- The historical integration-ingest append scan concern is left as a follow-up architecture decision because a clean fix needs a compact ID index or deliberately scoped validation path.

State:
- Implementation, completion-review fixes, and focused verification are complete; final commit/PR handoff remains.

Done:
- Read required repo routing, architecture, verification, security, reliability, and device-ingestion invariant docs.
- Created isolated worktree from current `origin/main`.
- Applied the supplied hard-cut patch and reconciled current-main drift.
- Regenerated contract artifacts and updated layout docs/tests for v2 integration-ingest journals.
- Verified focused contract, core ingest/migration, importer evidence, query, CLI/usecase, and workspace typecheck lanes.
- Ran required completion audit passes. Fixed accepted findings for migration boundedness, raw prune policy, restartable event rewrite, non-evidence legacy rawRefs, cross-month device externalRef reconciliation, and high-cardinality evidence parts.
- Root `pnpm test` was retried after the final fixes and again entered the assistant interactive chat UI with closed stdin; the process was terminated. Owner package checks listed below are green.

Now:
- Close the plan, commit, push, and open the PR.

Next:
- Handoff with verification notes, including unrelated root full-suite assistant timing flakes observed during `pnpm test`.

Open questions (UNCONFIRMED if needed):
- Whether the reconstructed patch fully matches the previously published implementation branch is UNCONFIRMED until diff and tests prove it.

Working set (files/ids/commands):
- Branch: `codex/land-integration-ingest-hard-cut`
- Patch artifact: supplied unified diff
- Expected owners: `packages/contracts`, `packages/core`, `packages/importers`, `packages/query`, `packages/cli`, docs/contracts, generated artifacts, provider/migration tests
- Full workspace `pnpm typecheck`: passed after completion-review fixes.
- Root `pnpm test`: blocked by unrelated assistant interactive chat UI under closed stdin; process terminated after fixture smoke and contracts artifacts completed.
- Latest post-review focused checks passed: `pnpm --dir packages/contracts test && pnpm --dir packages/contracts test:artifacts`; `pnpm --dir packages/core exec vitest run test/audit-boundary.test.ts test/vault-family-registry.test.ts test/core.test.ts test/device-import.test.ts test/import-device-batch-validation.test.ts test/wearable-storage-migration.test.ts test/wearable-receipts.test.ts --config vitest.config.ts --no-coverage`; `pnpm --dir packages/importers exec vitest run test/device-providers.test.ts test/device-providers-junction.test.ts test/device-providers/deletion-normalization.test.ts test/oura-coverage.test.ts test/strava.test.ts test/wearable-evidence.test.ts --config vitest.config.ts --no-coverage`; `pnpm --dir packages/query test`; `pnpm --dir packages/vault-usecases exec vitest run test/record-service-coverage.test.ts --config vitest.config.ts --no-coverage`; `pnpm --dir packages/cli exec vitest run test/cli-expansion-experiment-journal-vault-phase2.test.ts --config vitest.workspace.ts --no-coverage`; `git diff --check`; changed-file identifier scan.
Status: completed
Updated: 2026-06-21
Completed: 2026-06-21
