# Goal (incl. success criteria):
- Get the repo-level checks back to green from the current worktree state and leave `git status` clean.
- Success means the required top-level verification for the current dirty tree passes truthfully and there are no uncommitted tracked changes left.

# Constraints/Assumptions:
- Preserve unrelated work and avoid destructive cleanup unless it is clearly part of the requested clean-tree outcome.
- Prefer the smallest fix set that resolves the current repo-wide blockers.
- If dirty files represent legitimate in-flight work, land them rather than discarding them when feasible.

# Key decisions:
- Treat the current dirty tree as the target state to stabilize, not as noise to ignore.
- Start by fixing the top-level `pnpm typecheck` / `pnpm test:diff` failures, then decide whether the remaining dirty `apps/web` and manifest changes should be committed or otherwise resolved.

# State:
- completed

# Done:
- Repaired the broken workspace install state with `pnpm install --frozen-lockfile`, restoring the missing `incur` package resolution without changing tracked files.
- Fixed the stale `packages/cli/test/supplement-wearables-coverage.test.ts` type assertion so repo-wide `pnpm typecheck` passed.
- Added the missing version-scoped `@cobuild/review-gpt@0.5.55` minimum-release-age exemption expected by the release audit coverage.
- Moved assistant runtime-write and automation-run locks onto in-directory metadata while preserving legacy sibling-metadata compatibility during upgrade, and updated/focused the affected assistant-engine and CLI tests.
- Fixed the hosted-runtime context partial mock drift in `packages/assistant-runtime/test/hosted-runtime-context-coverage.test.ts`.
- Fixed the inbox canonical-evidence self-deadlock by running that path inside the canonical write lock scope, with the edge test restored.
- Updated stale Cloudflare deploy/node-runner expectations to match the current runner env/timeout contracts.
- Updated the setup wizard public-link flow test to select WHOOP explicitly under the current navigation behavior.
- Reverted misleading homepage `iMessage` marketing copy back to the currently implemented `Linq` surface while preserving the rest of the dirty web tree.
- Re-ran repo-wide verification successfully: top-level `pnpm typecheck` and top-level `pnpm test:diff` both passed on the final tree.

# Now:
- Commit the stabilized tree and leave `git status` clean.

# Next:
- None.

# Open questions (UNCONFIRMED if needed):
- None.

# Working set (files/ids/commands):
- Commands: `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm test:diff`, focused `vitest` package runs, `pnpm --dir apps/web verify`
- Files: repo green/cleanup touched `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, assistant/cloudflare/core/inboxd/setup/web test and runtime files, plus the active plan/ledger
Status: completed
Updated: 2026-04-11
Completed: 2026-04-11
