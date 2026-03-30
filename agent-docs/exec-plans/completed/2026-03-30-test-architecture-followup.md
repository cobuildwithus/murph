# 2026-03-30 Test Architecture Follow-up

## Goal

- Land the supplied test-architecture follow-up intent on top of the live dirty tree so fast package/unit loops stay separate from heavier web/app verification while keeping repo docs and command wrappers truthful.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-test-architecture-followup.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `README.md`
- `apps/web/README.md`
- `package.json`
- `packages/web/package.json`
- `apps/web/package.json`
- `scripts/workspace-verify.sh`
- `vitest.config.ts`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`

## Findings

- The supplied patch is stale relative to the current branch: the root `vitest.config.ts` already exists and already delegates to package-level project configs, but the command wrapper and docs still describe the older heavier `test:packages` behavior.
- `packages/web/package.json` and `apps/web/package.json` have already dropped explicit `--maxWorkers 1`, but their `test` scripts still run the heavier typecheck/smoke/build flow instead of the fast Vitest-only loop requested by the patch.
- The workspace wrapper still couples package coverage to the web/app verify lanes, and the repo root currently has no `test:apps` split.
- The change overlaps active green-checks and root verification-doc/script lanes, so the landing must preserve adjacent edits and stay scoped to the supplied verification split plus any required doc truth fixes.

## Constraints

- Treat the supplied patch as intent, not as authority to overwrite the current worktree.
- Preserve overlapping dirty edits and active ledger lanes.
- Keep the landing proportional: no unrelated Vitest refactors or extra package-local command churn.
- For non-doc repo changes touching production code or tests, run the required completion audits in order: `simplify` then `task-finish-review`.

## Plan

1. Register the lane in the coordination ledger and capture the current overlap in this plan.
2. Update root scripts/config plus package/app-local `test` and `verify` commands to match the requested split.
3. Update user-facing and durable verification docs so command descriptions match the new behavior.
4. Run required verification, fix any regressions, then complete the required simplify and final-review audits.
5. Close the plan and commit only the exact touched files for this lane.

## Verification

- Passed: `pnpm --dir packages/web test`
- Passed: `pnpm --dir apps/web test`
- Passed: `pnpm test:apps`
- Passed: `pnpm typecheck`
- Failed: `pnpm test`
  - existing failure: `packages/cli/test/cli-expansion-workout.test.ts` (`initResult.ok` was `false`, expected `true`)
- Failed: `pnpm test:coverage`
  - existing failure: `packages/cli/test/gateway-core.test.ts` asserted stderr should not contain the Node SQLite experimental warning
- Extra signal: `pnpm test:packages`
  - existing failures on the dirty branch included `packages/cli/test/inbox-cli.test.ts`, `packages/assistantd/test/http.test.ts`, and `packages/assistantd/test/service.test.ts`
- Passed: direct scenario check `pnpm test:apps`
  - exercised `packages/web verify`, `apps/web verify`, and `apps/cloudflare verify` end-to-end
- Failed: `pnpm review:gpt --chat-url https://chatgpt.com/c/69c9efd5-b2d0-8329-84ea-3d8cead2281c --preset task-finish-review --send ...`
  - attempted twice; managed browser reached the target thread and attached the audit ZIP, but autosend timed out because the existing ChatGPT composer state would not commit the new prompt

## Outcome

- Ready to close: implementation and direct app-lane proof are complete; repo-wide `test` and `test:coverage` remain blocked by unrelated existing CLI failures, and the requested review-gpt autosend was attempted twice but blocked by the target thread's browser/composer state.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
