## Goal (incl. success criteria):
- Make the repo's required verification commands pass from the current HEAD on a clean run.
- Eliminate generated worktree drift so `git status --short` is empty at handoff.
- Keep the fix scoped to repo verification/cleanup behavior without regressing the already-landed Cloudflare hardening work.

## Constraints/Assumptions:
- Preserve unrelated user edits if any appear during the task.
- Do not expose secrets or personal identifiers.
- Prefer fixing the repo wrapper/runtime-artifact preparation over weakening checks or skipping lanes.

## Key decisions:
- Treat the root `pnpm test` clean-run failure as a repo workflow bug because the app verify lane races the prepared-artifact build.
- Verify from a clean state after patching the wrapper, then clean generated tracked drift only when it is confirmed to be produced by repo tooling.

## State:
- completed

## Done:
- Confirmed the current root `pnpm test` failure is caused by `scripts/workspace-verify.sh` starting `run_test_apps` before `prepare_repo_vitest_runtime_artifacts` completes on a clean run.
- Fixed the workspace wrapper so prepared runtime artifacts are built before app verification starts, app verification no longer overlaps the repo Vitest lane, and the local default Vitest worker budget is reduced to a stable level.
- Added focused hosted-execution coverage for managed-user provisioning, malformed managed-user responses, usage query filtering, env override parsing, and Vercel base URL normalization.
- Tightened the assistant tool-definition boundary so inbox model bundles always emit tool provenance metadata.
- Verified `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` all pass on the updated wrapper.

## Now:
- Close the active plan and commit the verified repo-check repair set.

## Next:
- None.

## Open questions (UNCONFIRMED if needed):
- None.

## Working set (files/ids/commands):
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `agent-docs/exec-plans/active/2026-04-06-repo-checks-green-clean.md`
- `scripts/workspace-verify.sh`
- `packages/hosted-execution/test/hosted-execution.test.ts`
- `packages/assistant-core/src/model-harness.ts`
- `apps/cloudflare/src/usage-store.ts`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Status: completed
Updated: 2026-04-06
Completed: 2026-04-06
