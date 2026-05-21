# Hosted Temporal Cleanup PR

## Goal

Land the small cleanup/simplification pass after the Temporal hard cut.

Success criteria:

- Remove dead in-memory local ensure state from the Cloudflare runner.
- Keep legacy nudge/scheduler RPC names mechanically banned from production source.
- Tighten the shared ensure-execution response contract so
  `runtimeResultNextWakeReason` is required like the exported type says.
- Allow manual and mailbox-lag signal source churn through the same bounded safe
  string policy as mailbox sources.
- Document that product/usage blocks are successful demand responses, not
  Temporal activity failures.

## Constraints

- Preserve unrelated dirty Murph Age, hosted-local dashboard, MinIO, README, and
  ledger edits.
- Do not delete legacy runner state columns/projections before the documented
  compatibility window.
- Do not weaken Cloudflare callback/write-fence trust boundaries.
- Do not add new scheduling state or deployment requirements.

## Plan

1. Remove `localEnsureInFlight`, `retiredEnsurePromises`, and the retire helper.
2. Extend the hosted Temporal guard so those local ensure leftovers cannot
   return in production Cloudflare source.
3. Tighten hosted orchestration parser/types/tests for signal sources and
   required runtime next-wake reason.
4. Update the Temporal ADR with the usage-block/activity-failure invariant.
5. Run focused typecheck/tests/guard, required reviews, then commit through
   `scripts/finish-task`.

## Verification

Passed:

- `pnpm hosted-temporal:guard`
- `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-hosted-temporal-orchestration-guards.test.ts`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage test/hosted-orchestration-control.test.ts` from `packages/hosted-execution`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/index.test.ts`
- `pnpm --filter @murphai/cloudflare-runner typecheck`
- `pnpm --filter @murphai/hosted-execution typecheck`
- `pnpm typecheck`

Audits:

- Security/privacy review: no concrete findings.
- Coverage/proof worker: added guard-token coverage and concurrent
  persisted-write-fence ensure coverage.
- Final completion review: no findings.
Status: completed
Updated: 2026-05-21
Completed: 2026-05-21
