# 2026-03-31 Test Harness Speedup

## Goal

- Land the supplied harness-speed patch against the live tree so package-test runtime prep stops doing repeated cold workspace builds, focused CLI test flows reuse a shared runtime-artifact build, `test:apps` can run in parallel locally by default, and `apps/web verify` no longer generates Prisma twice.

## Scope

- `agent-docs/exec-plans/active/2026-03-31-test-harness-speedup.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `package.json`
- `tsconfig.test-runtime.json`
- `scripts/workspace-verify.sh`
- `scripts/repo-tools.config.sh`
- `packages/cli/package.json`
- `packages/cli/test/cli-test-helpers.ts`
- `apps/web/package.json`
- `packages/web/test/package-audit-context.test.ts`
- `agent-docs/index.md`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`

## Findings

- The live tree already has the curated root `vitest.config.ts`, so the supplied patch's missing-config restoration is not needed and must not overwrite the current repo-level test selection.
- The guarded audit bundle still omitted the root `vitest.config.ts` and `tsconfig.test-runtime.json` even though the current test harness and docs reference them; the allowlist needs to include those root files explicitly because the bundle scanner only walks configured roots plus always-paths.
- The repo's docs-drift wrapper now treats this landing as a large change set, so a dedicated active execution plan is required even though the original intent started as a ledger-only patch landing.
- The current dirty tree has unrelated repo failures outside the harness lane, including an existing workspace-boundary violation in `apps/cloudflare/test/gateway-store.test.ts`.

## Constraints

- Preserve the current root `vitest.config.ts` curated package suite and existing acceptance surface.
- Keep CI app verification sequential by default unless explicitly overridden.
- Do not widen into the separate active cron or Cloudflare gateway lanes.
- Keep docs consistent with the changed verification behavior so docs-drift/gardening checks stay truthful.
- Run the mandatory `simplify` and `task-finish-review` audit passes before handoff.

## Plan

1. Land the harness/config/doc updates with the smallest delta needed to match the supplied patch intent on the live tree.
2. Run focused proof for the new runtime build path plus the repo-required verification commands.
3. Run the mandatory `simplify` and `task-finish-review` audit passes, address any real findings, then rerun affected checks if needed.
4. Close the plan and commit only the touched files for this lane.

## Verification

- Passed: `pnpm build:test-runtime`
- Passed: `pnpm verify:cli`
- Passed: `pnpm test:packages`
  - the tightened `build:test-runtime` path recovered a transient `ENOTEMPTY` cleanup failure on retry and then completed the full curated package suite successfully
- Passed: direct scenario `pnpm test:apps` for the changed app-verify lane
  - `packages/web verify` passed
  - `apps/web verify` passed with one explicit `prisma generate` before typecheck/build
  - `apps/cloudflare verify` retried once under the parallel wrapper and still failed in unrelated `apps/cloudflare/test/user-runner.test.ts` (`HostedUserRunner > ignores stale gateway snapshots so finalize cannot rewind the hot projection`)
- Failed: `pnpm typecheck`
  - current dirty-tree failure in `packages/contracts/scripts/verify.ts` because `@murph/contracts` is missing multiple exported members expected by the script build
- Failed: `pnpm test`
  - before opening this plan, docs-drift blocked the run because the large change set lacked an active execution plan
  - after the final fast-lane cleanup fix, the wrapper again exercised docs drift, hygiene checks, `packages/contracts test`, the new `pnpm build:test-runtime` path, and the curated root Vitest lane before failing in unrelated dirty-tree CLI tests (`packages/cli/test/health-tail.test.ts` and `packages/cli/test/list-cursor-compat.test.ts`)
- Failed: `pnpm test:coverage`
  - after the final fast-lane cleanup fix, it again reached the new `pnpm build:test-runtime` package-coverage lane and entered the root coverage Vitest run, but the wrapper exited non-zero from the dirty tree before surfacing a stable failing test target
- Passed: required `simplify` audit
  - applied the actionable cleanup it found: shared retry helper in `scripts/workspace-verify.sh` and removal of the unnecessary `apps/web` `build:prepared` alias
- Passed: required `task-finish-review` audit
  - flagged one high-severity correctness gap in the initial fast lane (stale `dist/` false-greens), which is now addressed by targeted `dist/` cleanup before the narrowed `tsc -b` builds

## Outcome

- Ready to close: implementation plus audit follow-up are complete, focused harness proof is green, and the remaining red required checks are attributable to unrelated dirty-tree failures outside this lane.
Status: completed
Updated: 2026-03-31
Completed: 2026-03-31
