Goal (incl. success criteria):
- Resolve accepted PR 252 review findings without widening the architecture.
- Success means legacy v1 integration-ingest migration has a real operator CLI path, finalization is locked/idempotent and can finish genuine empty v1 vaults, normal device ingest append work avoids migration-wide scans, and focused regressions prove those paths.

Constraints/Assumptions:
- Keep the hard cut: no dual writes, compatibility resolver, archive index, tombstone farm, nested compression, or generic migration framework.
- Preserve core as the only canonical vault mutation owner; CLI and vault-usecases stay thin orchestration surfaces.
- Fail closed on malformed or conflicting legacy evidence.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Expose the existing core migration as one named repair command instead of adding a new service or framework.
- Treat already-current v2 migration apply as a no-op.
- Finalize under the existing migration lock and create missing required directories before advancing `vault.json`.
- Limit ordinary append duplicate checks to deterministic target monthly shards; keep full ledger scans for explicit validation, migration, and provenance reads.

State:
- Ready to commit and push.

Done:
- Review findings triaged and scoped to minimal fixes.
- Initial code paths patched for repair command, locked finalization, v2 no-op, and target-shard append validation.
- Focused core and CLI regression tests added.
- `pnpm --dir packages/core exec vitest run test/wearable-storage-migration.test.ts test/device-import.test.ts --config vitest.config.ts --no-coverage` passed.
- `pnpm --dir packages/cli exec vitest run test/cli-expansion-experiment-journal-vault-phase2.test.ts --config vitest.config.ts --no-coverage` passed.
- Security/privacy, coverage-write, and deep-review completion audits ran; accepted findings were fixed with narrow code/test changes.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed.
- `pnpm test:smoke` passed.
- `git diff --check` passed.
- Diff scan found no local path or identifier leakage outside the plan/ledger.

Now:
- Commit with `scripts/finish-task` and push the PR branch.

Next:
- Rerun the PR review loop and check PR CI on the pushed head.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/core/src/integration-ingest-migration.ts
- packages/core/src/integration-ingests.ts
- packages/core/test/wearable-storage-migration.test.ts
- packages/core/test/device-import.test.ts
- packages/vault-usecases/src/usecases/types.ts
- packages/vault-usecases/src/usecases/integrated-services.ts
- packages/vault-usecases/src/usecases/runtime.ts
- packages/vault-usecases/src/vault-services.ts
- packages/cli/src/commands/vault.ts
- packages/cli/src/incur.generated.ts
- packages/cli/test/cli-expansion-experiment-journal-vault-phase2.test.ts
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
