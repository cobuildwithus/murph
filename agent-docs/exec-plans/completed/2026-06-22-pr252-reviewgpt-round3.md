Goal (incl. success criteria):
- Resolve accepted ReviewGPT round-3 findings for PR 252 without widening the integration ingest architecture.
- Success means hosted workspaces migrate legacy v1 vault snapshots before serving them, runtime provenance lookups avoid full journal materialization, and verification remains green.

Constraints/Assumptions:
- Keep the hard cut: no dual writes, compatibility resolver, raw-artifact evidence fallback, archive index, per-ingest storage redesign, or generic migration framework.
- Migration belongs at an explicit hosted lifecycle boundary, not hidden inside ordinary vault reads.
- Monthly integration ingest journals remain the storage contract for device evidence.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Accept the missing hosted migration gate as a production lifecycle issue.
- Reject replacing monthly journals with per-ingest files as out-of-scope architecture churn for this PR.
- Harden runtime lookup helpers with streaming scans while leaving full validation/migration scans as explicit audit paths.

State:
- Ready to commit and push.

Done:
- ReviewGPT round-3 findings triaged.
- Added an explicit hosted post-restore vault format gate that runs the bounded v1-to-v2 migration only when restored metadata is legacy.
- Kept current v2 hosted workspaces on a cheap metadata-version check.
- Replaced runtime ingest provenance helpers with streaming scans so they do not materialize all journal entries.
- Added focused regressions for hosted snapshot restore migration and streaming ingest provenance lookups.
- Focused core regression passed: `pnpm --dir packages/core exec vitest run test/device-import.test.ts --config vitest.config.ts --no-coverage`.
- Focused hosted regression passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --config vitest.config.ts --no-coverage -t "legacy vault metadata"`.
- Timing-sensitive hosted runtime regression passed after current-vault gate was reduced to a metadata-only check: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-workspace-entrypoint.test.ts --config vitest.config.ts --no-coverage -t "no-progress runtime wakes"`.
- `pnpm typecheck` passed.
- `pnpm test:diff` passed.
- `pnpm test:smoke` passed.
- `git diff --check` passed.
- Diff privacy scan found no local identifier, home/temp path, or obvious secret-string leakage.

Now:
- Commit with `scripts/finish-task`.

Next:
- Push and confirm PR checks.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/assistant-runtime/src/hosted-runtime.ts
- packages/assistant-runtime/test/hosted-runtime-workspace-entrypoint.test.ts
- packages/core/src/integration-ingests.ts
- packages/core/test/device-import.test.ts
- PR 252
Status: completed
Updated: 2026-06-22
Completed: 2026-06-22
