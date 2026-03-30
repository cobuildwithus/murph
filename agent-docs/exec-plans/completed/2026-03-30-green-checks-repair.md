# 2026-03-30 Green Checks Repair

## Goal

- Get the required repo commands fully green on the current worktree: `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.

## Scope

- `agent-docs/exec-plans/active/2026-03-30-green-checks-repair.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- The smallest set of source, test, or config files directly required to clear the current blockers discovered by rerunning the required commands.

## Findings

- Initial repo state includes overlapping active lanes across `apps/web`, `packages/cli`, `packages/query`, `packages/core`, and verification tooling, plus unrelated dirty docs/prompt files already in the worktree.
- The earlier green-checks ledger row points at a missing plan file, so this pass needs fresh plan bookkeeping before any code edits.
- The pending diff also includes a broader repo-root Vitest project consolidation across package/app configs, workspace verification scripts, CI, and verification docs, so the green-checks pass had to validate both feature work and the harness changes together.
- The initial CLI red set was stale test setup rather than runtime breakage: parser-queue tests still used default image attachments even though `inboxd` now only enqueues parse jobs for `audio`, `document`, and `video`.
- The remaining repo-wide blocker after those CLI fixes was another stale expectation in `apps/cloudflare/test/node-runner.test.ts`, where the hosted artifact-missing path still ingested an image attachment but asserted that a pending parse job existed.
- Focused no-coverage sweeps across the previously suspicious CLI/query/assistant-runtime tests passed once the stale attachment fixtures were corrected; no extra source/runtime changes were required.

## Constraints

- Preserve overlapping dirty edits and active lanes already registered in the coordination ledger.
- Keep fixes proportional to the failing checks; do not widen into speculative cleanup while pursuing green status.
- Record exact blockers and affected commands as they are discovered, then repair them in the narrowest safe order.

## Plan

1. Register the current repair lane in the coordination ledger and rerun `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage`.
2. Fix the first blocking failure with the smallest safe change, preserving adjacent in-flight edits.
3. Run focused verification for any touched area when a local proof is cheaper than rerunning the full repo immediately.
4. Repeat until all three required repo commands pass on the current worktree.
5. Close the plan and commit only the exact touched files.

## Verification

- Passed: `pnpm typecheck`
- Passed: `pnpm test`
- Passed: `pnpm test:packages:coverage`
- Passed: `pnpm test:coverage`
- Passed focused regressions:
  - `pnpm --dir packages/cli typecheck`
  - `pnpm exec vitest run --config vitest.config.ts packages/cli/test/inbox-cli.test.ts -t "inbox parse and requeue drive parser queue controls without real tool binaries|inbox requeue can reset running attachment parse jobs" --no-coverage`
  - `pnpm exec vitest run --config vitest.config.ts packages/cli/test/health-tail.test.ts -t "condition and allergy commands keep noun-specific and generic reads aligned|profile list and current show preserve canonical links and strip reserved fields|supplement commands expose product metadata and a rolled-up compound ledger" --no-coverage`
  - `pnpm --dir packages/cli exec vitest --run test/cli-expansion-inbox-attachments.test.ts --coverage.enabled=false`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/node-runner.test.ts -t "fails hosted execution when an externalized artifact cannot be fetched" --no-coverage`

## Outcome

- Done: repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` are all green on the current worktree after aligning stale parser-queue fixtures with the current attachment parsing contract.
Status: completed
Updated: 2026-03-30
Completed: 2026-03-30
