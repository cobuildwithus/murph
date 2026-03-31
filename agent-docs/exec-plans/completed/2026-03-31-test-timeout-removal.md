# Disable test runner timeouts so suites run to completion

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

- Remove Vitest-enforced runner timeouts across the repo so tests, hooks, and teardown phases are allowed to finish instead of being aborted by default timeout limits.

## Success criteria

- Every repo-owned Vitest config applies the shared no-timeout policy for tests, hooks, and teardown.
- Scoped verification confirms the timeout change without reintroducing the worker-termination timeout warnings.

## Scope

- In scope:
  - Root, package, app, and workspace-split Vitest configuration under tracked `vitest*.ts` files.
  - Small shared config helper if needed to keep the timeout policy consistent.
- Out of scope:
  - Production/runtime HTTP, network, daemon, or workflow timeout behavior outside Vitest.
  - Historical completed plan snapshots.

## Constraints

- Technical constraints:
  - Preserve existing project includes, worker caps, aliases, and file-parallelism behavior.
- Product/process constraints:
  - Do not revert unrelated dirty worktree edits.
  - Keep the change limited to test-runner behavior.

## Risks and mitigations

1. Risk: Broad config edits drift into unrelated timeout semantics.
   Mitigation: Touch only `vitest*.ts` files plus a dedicated shared helper for Vitest timeout values.

## Tasks

1. Add the coordination-ledger row and record the intended no-timeout policy.
2. Patch all repo-owned Vitest configs to disable test, hook, and teardown timeouts consistently.
3. Run required verification and confirm the timeout sweep did not break the test stack.

## Decisions

- Use Vitest's supported `0` values for `testTimeout`, `hookTimeout`, and `teardownTimeout` instead of deleting config and falling back to defaults.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:apps`
  - `pnpm test:packages`
  - `pnpm test:packages:coverage`
- Expected outcomes:
  - `pnpm typecheck`: passed
  - `pnpm test`: failed for unrelated invalid smoke scenario ids in `e2e/smoke/scenarios/*.json`
  - `pnpm test:apps`: passed after replacing `teardownTimeout: 0` with the maximum safe Node timer value
  - `pnpm test:packages`: failed for unrelated existing assertion in `packages/cli/test/health-tail.test.ts`
  - `pnpm test:packages:coverage`: failed for unrelated existing package-resolution errors in the CLI coverage lane
  - Focused reruns no longer emitted `[vitest-pool]: Timeout terminating forks worker...` after the teardown fix
Completed: 2026-03-31
