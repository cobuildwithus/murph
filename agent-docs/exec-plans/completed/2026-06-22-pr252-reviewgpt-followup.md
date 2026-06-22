Goal (incl. success criteria):
- Resolve accepted ReviewGPT follow-up findings for PR 252 without widening the integration ingest architecture.
- Success means oversized legacy evidence is reported as a migration blocker instead of throwing, ordinary ingest appends stream existing-shard duplicate checks, oversized serialized ingest rows are rejected before staging, and verification remains green.

Constraints/Assumptions:
- Keep the hard cut: no dual writes, raw-artifact evidence fallback, compatibility resolver, archive index, or generic migration framework.
- Preserve core as the canonical mutation owner; CLI/usecase surfaces stay thin.
- Fail closed on malformed, conflicting, or unrepresentable legacy evidence.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Reject the proposed raw-artifact collapse because it reintroduces the physical evidence path removed by the hard cut.
- Treat legacy evidence that cannot fit the v2 journal row limits as an explicit blocker requiring operator remediation.
- Limit ordinary append validation to streaming duplicate lookup for requested ingest IDs; full journal integrity remains with explicit validation/migration reads.

State:
- Ready to commit and push.

Done:
- ReviewGPT findings triaged.
- Rejected the raw-artifact collapse recommendation as contrary to the hard-cut storage contract.
- Added explicit migration blockers for legacy evidence that cannot fit v2 evidence or journal row limits.
- Replaced ordinary append's full target-shard ingest scan with streaming requested-ID lookup.
- Added a serialized ingest row cap before staging append payloads.
- Added focused device-import and migration regressions.
- Focused core regression run passed: `pnpm --dir packages/core exec vitest run test/device-import.test.ts test/wearable-storage-migration.test.ts --config vitest.config.ts --no-coverage`.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed.
- `pnpm test:smoke` passed.
- Root `pnpm lint` is unavailable in this repo; affected lint/verify lanes ran through `pnpm test:diff`.
- `git diff --check` passed.
- Diff privacy scan found no local identifier leakage in task diff.

Now:
- Commit with `scripts/finish-task`.

Next:
- Push and confirm PR checks.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/core/src/integration-ingests.ts
- packages/core/src/integration-ingest-migration.ts
- packages/core/test/wearable-storage-migration.test.ts
- packages/core/test/device-import.test.ts
- audit-packages/pr-252-round-2.md
- PR 252
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
