## Goal

Cut the hosted Cloudflare runner down to a thin execution shim so web-owned `HostedWake` / `HostedExecutionCursor` rows are the only queue correctness owners and the Durable Object keeps only lease, epoch, alarm, warm-bundle reuse, and stale-result guard state.

## Scope

- `apps/cloudflare/src/index.ts`
- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/web-control-plane.ts`
- `apps/cloudflare/src/user-runner/{runner-queue-store,runner-queue-schema,runner-dispatch-processor,runner-commit-recovery,runner-scheduler,types}.ts`
- `apps/cloudflare/test/**` hosted wake / duplicate-executor / worker harness coverage
- `apps/web/app/api/internal/hosted-wake/**`
- `apps/web/src/lib/hosted-wake/**`
- `apps/web/test/hosted-wake-routes.test.ts`
- durable docs that describe Cloudflare queue ownership if the implementation changes the current architecture contract

## Constraints

- Keep `apps/web` / Postgres as the canonical owner of queue ordering, wake lifecycle, cursor high-water, and snapshot pointer truth.
- Preserve the duplicate-executor fence: stale or duplicate runners must lose the cursor CAS and discard local results.
- Do not reintroduce broad Cloudflare control-plane ownership for pending, consumed, or poisoned event history.
- Treat this lane as greenfield: remove transitional compatibility paths when the new hosted-wake owner is proven rather than preserving legacy fallbacks.
- Preserve unrelated hosted wake follow-up cleanup work already present in the tree.

## Verification

- `pnpm typecheck`
- Truthful scoped coverage or diff-aware verification for the touched `apps/cloudflare`, `apps/web`, and any touched shared packages
- Required completion audits per repo workflow before commit

## Progress

- Added the hosted wake status callback route in `apps/web` and switched Cloudflare status/dispatch outcome reads onto the web-owned cursor/lifecycle path.
- Tightened durable commit equivalence so duplicate committed results are accepted when assistant-delivery fingerprints match even if regenerated transport ids rotate.
- Updated the duplicate-commit local E2E harness to use a test-only hosted-wake control plane sidecar instead of relying on the old local-owner queue path.
- Aligned the runner outcome tests with the thin-shim ownership boundary so duplicate pending/consumed paths assert no extra runner invoke, and poisoned local rows no longer masquerade as canonical dispatch truth.
- Scoped verification currently green:
  - `pnpm --filter @murphai/assistant-runtime typecheck`
  - `pnpm --filter @murphai/cloudflare-runner typecheck`
  - `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-platform apps/cloudflare/test/web-control-plane.test.ts apps/cloudflare/test/execution-journal.test.ts --no-coverage`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --project cloudflare-node-runner apps/cloudflare/test/user-runner.test.ts --testNamePattern "shared dispatch outcome surface|evt_missing_commit" --no-coverage`
  - `pnpm --filter @murphai/cloudflare-runner test:e2e:duplicate-commit:local`
Status: completed
Updated: 2026-04-18
Completed: 2026-04-18
