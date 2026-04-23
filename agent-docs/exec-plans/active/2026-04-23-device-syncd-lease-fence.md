# Fence expired `device-syncd` leases through execution and terminal writes

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Ensure an expired `device_job` lease no longer grants execution authority for provider side effects, token refresh persistence, or terminal job transitions.
- Preserve the intended per-account serialization fence when a second worker reclaims an expired job lease.

## Why

- `claimDueDeviceSyncJob()` already allows another worker to reclaim a job once `lease_expires_at <= now`.
- The active execution path still authorizes work using only `status === "running"` plus `leaseOwner === workerId`, so a stale worker can continue importing snapshots or persisting refreshed tokens after its lease expires.
- The owned terminal updates likewise ignore lease expiry, so a stale worker can still mark a reclaimed job succeeded or dead.

## Scope

- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/src/store/jobs.ts`
- directly coupled `packages/device-syncd/test/{service,store}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-device-syncd-lease-fence.md,COORDINATION_LEDGER.md}`

## Out of scope

- lease-heartbeat or renewal redesign
- provider-specific job behavior changes
- hosted runtime or webhook-path changes
- unrelated `device-syncd` provider work already dirty elsewhere in the tree

## Constraints

- Keep the fix additive and narrow to the lease-fence seam.
- Preserve the current reclaim model where expired leases become claimable immediately.
- Treat lease expiry as part of execution authority everywhere the current worker performs side effects or terminal job writes.
- Coordinate carefully with the active disconnect/hydration row that also claims `service.ts` and `store/jobs.ts`; keep this change on the lease-authority slice only.
- Follow the high-risk repo workflow: plan-bearing lane, coverage-bearing verification, required audits, and a scoped commit only if exact staging is clean in the dirty tree.

## Risks and mitigations

1. Risk: Tightening the authority check could strand legitimately long-running jobs.
   Mitigation: Keep the current behavior fail-closed and document the remaining gap; this patch restores the existing lease contract rather than introducing renewal in the same change.
2. Risk: Terminal transitions could silently stop applying after expiry and leave jobs running.
   Mitigation: Add direct store regression coverage plus service coverage showing reclaimed jobs stay owned by the reclaiming worker and stale workers stop mutating them.

## Tasks

1. Register the lease-fence seam in the coordination ledger and inspect the current execution/store tests.
2. Require an unexpired lease for execution-side authority checks in `service.ts`.
3. Require an unexpired lease for `completeDeviceSyncJobIfOwned()` and `failDeviceSyncJobIfOwned()`.
4. Add regression tests covering stale-worker side-effect cancellation and expired-lease terminal-transition rejection.
5. Run truthful `packages/device-syncd` verification, then the required audit and commit flow.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/device-syncd/src/service.ts packages/device-syncd/src/store/jobs.ts packages/device-syncd/test/service.test.ts packages/device-syncd/test/store.test.ts`
- Direct proof:
  - a worker whose lease has expired stops before provider side effects persist
  - terminal `complete`/`fail` transitions reject expired leases even when `lease_owner` still matches

## Latest results

- Focused proof is green: `pnpm --dir packages/device-syncd test -- test/service.test.ts test/store.test.ts`
- `pnpm typecheck` is red for unrelated existing branch issues, including stale `packages/vault-usecases` boundary/type failures and long-standing `packages/device-syncd` test private-access errors.
- `bash scripts/workspace-verify.sh test:diff ...` is red for unrelated existing `packages/vault-usecases/src/vault-services.ts` type errors reached through reverse-dependent fanout.
- `pnpm --dir packages/device-syncd test:coverage` is red for unrelated existing churn in `packages/device-syncd/test/service.test.ts` outside this lease-fence slice.
- Required `coverage-write` and `task-finish-review` audit passes both ran. Review findings about stranded expired final-attempt jobs and stale dedupe starvation were fixed in the current diff.
- A clean scoped commit is not safe in this checkout because the touched `packages/device-syncd/test/*.test.ts` files and shared `COORDINATION_LEDGER.md` already carry unrelated branch churn, so committing those paths would absorb non-task edits.
