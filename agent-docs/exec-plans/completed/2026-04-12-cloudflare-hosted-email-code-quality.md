# Goal (incl. success criteria):
- Land the supplied Cloudflare hosted-email code-quality patch without changing behavior or disturbing overlapping work.
- Success means the worker env trust boundary uses one named helper, hosted-email route-store naming clearly separates crypto keys from storage object keys, and verified-sender config checks are collapsed without changing the routing outcome.

# Constraints/Assumptions:
- Preserve unrelated dirty worktree edits, especially overlapping `apps/cloudflare/**`, `apps/web/**`, and `packages/**` lanes already registered in the coordination ledger.
- Keep the landing narrow to the supplied patch intent and any audit-driven verification fixes.
- Treat worker-env narrowing and hosted-email routing as trust-boundary code; changes must stay behavior-preserving and fail closed.

# Key decisions:
- Reuse the existing string-only env narrowing seam behind a worker-boundary helper named `asWorkerStringEnvironment(...)`.
- Clarify hosted-email route-store naming by distinguishing encryption keys from derived storage object keys.
- Collapse repeated verified-sender readiness checks behind one small resolver instead of widening into broader hosted-email refactors.

# State:
- ready_to_close

# Done:
- Read the repo routing, completion, verification, and security docs for this repo code task.
- Inspected the supplied patch and current Cloudflare files to identify the still-applicable hunks and current overlap with other active lanes.
- Registered the active coordination lane.
- Landed the named worker env boundary helper and the hosted-email route-store/routes cleanup on top of the current Cloudflare tree.
- Completed the required `coverage-write` and `task-finish-review` audit passes; neither required additional code changes.
- Captured focused proof with `vitest` on `apps/cloudflare/test/{hosted-email,env}.test.ts`, syntax checks on the touched source files, and a direct `tsx` seam check for `asWorkerStringEnvironment(...)`.

# Now:
- Close the active plan and create the scoped commit for the touched Cloudflare paths.

# Next:
- Hand off with the exact verification outcomes, including the unrelated pre-existing blockers on `pnpm typecheck` and the Cloudflare `test:diff` lane.

# Open questions (UNCONFIRMED if needed):
- `pnpm typecheck` still fails for unrelated pre-existing `apps/web` type/test drift.
- `bash scripts/workspace-verify.sh test:diff ...` for this Cloudflare slice still fails for the unrelated pre-existing `apps/cloudflare/test/node-runner.test.ts:1657` type error on `providerMetadataJson`.
- Some touched Cloudflare files overlap with another active Cloudflare lane already in the dirty tree; the final commit must keep the scope narrow and call out that overlap.

# Working set (files/ids/commands):
- Files: this plan, `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`, `apps/cloudflare/src/{worker-contracts.ts,index.ts,runner-outbound.ts,runner-outbound/results.ts,hosted-email/{route-store.ts,routes.ts,worker-ingress.ts}}`
- Commands: `git diff --check`, `node --check --experimental-strip-types ...`, `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/env.test.ts --no-coverage`, `pnpm exec tsx --eval ...`, `pnpm typecheck`, `bash scripts/workspace-verify.sh test:diff ...`, required audit helpers, commit helper
- Patch source: supplied Cloudflare hosted-email code-quality patch
Status: completed
Updated: 2026-04-12
Completed: 2026-04-12
