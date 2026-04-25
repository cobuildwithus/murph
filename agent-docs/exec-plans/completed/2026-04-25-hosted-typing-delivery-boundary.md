# Hosted Typing Delivery Boundary

## Goal

Stop hosted runner-owned typing keepalive activity at the actual committed assistant-delivery boundary so Linq typing refreshes cannot fire after the user-visible reply is sent.

Success criteria:

- Runner-owned messaging activity is cancelled before post-commit assistant deliveries are sent.
- The stop path is idempotent and does not regress runtime-owned fallback typing behavior.
- Successful typing stops are observable without logging raw channel identifiers.
- Regression coverage proves no runner-owned refresh can survive past committed delivery.

## Constraints

- Preserve the run-centric hosted protocol and web-owned finalize recovery model.
- Do not log raw contact identifiers, message text, provider payloads, or secrets.
- Keep changes scoped to hosted runtime/Cloudflare runner typing lifecycle seams and directly coupled tests.
- Preserve unrelated dirty work in the shared worktree.

## Current State

Implemented. Runner-owned messaging activity now stops through the hosted runtime platform boundary before committed assistant deliveries drain, with fallback cleanup preserved when the runner stop is unavailable or reports no active handle.

## Verification Plan

- Focused assistant-runtime tests for the delivery-boundary stop callback and stop logging.
- Focused Cloudflare runner finalization tests for owner-handle cancellation ordering.
- `pnpm typecheck`.
- Diff-aware or scoped verification for touched `packages/assistant-runtime` and `apps/cloudflare` files where feasible.

## Verification Results

- `pnpm --dir packages/assistant-runtime test -- hosted-runtime-finalize-coverage.test.ts hosted-runtime-typing.test.ts`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm exec vitest run apps/cloudflare/test/runner-platform.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/node-runner.test.ts --config apps/cloudflare/vitest.node.workspace.ts --no-coverage`
- `pnpm --dir packages/hosted-execution test -- hosted-execution.test.ts`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm typecheck`
- `pnpm test:smoke`
- `git diff --check` on touched files
- `scripts/workspace-verify.sh test:diff` reached an unrelated `apps/cloudflare/test/deploy-automation.test.ts` optional worker-secret binding failure from separate deploy-env work.
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
