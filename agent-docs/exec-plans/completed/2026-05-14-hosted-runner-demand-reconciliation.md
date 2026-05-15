# Hosted Runner Demand Reconciliation

## Goal

Finish the hosted runner simplification so `UserRunner` reconciles durable
demand into an idempotent container processing command, while `RunnerContainer`
owns the wake/start lifecycle distinction.

## Success Criteria

- `HostedUserRunner` no longer exposes progress result kinds that treat local
  promises as liveness proof.
- `RunnerContainer` exposes an idempotent `ensureProcessing` RPC that wakes the
  exact active child or starts replacement processing when the child is not
  wakeable.
- Public runner nudge results stop advertising `alreadyRunning` as orchestration
  progress.
- Watchdog/alarm paths route through the same reconciliation loop as nudges.
- Focused tests cover the stale local in-flight plus no-active-child regression
  and the container wake/start ownership split.

## Scope

- `apps/cloudflare/src/user-runner.ts`
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/user-runner-alarm.test.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- Hosted runner contracts/docs only where needed for API/result vocabulary.

## Out Of Scope

- New durable tables or a second running flag.
- Web mailbox schema changes.
- Provider egress, runner image, or deploy automation changes.
- Broad hosted-local E2E harness work.

## Plan

1. Map the existing nudge, alarm, write-fence, and container RPC contracts.
2. Add container-owned `ensureProcessing` while keeping deploy-skew-compatible
   wake behavior where required.
3. Collapse `HostedUserRunner` progress results around durable demand/fence
   reconciliation and demote local promises to coalescing only.
4. Remove `alreadyRunning` from the current internal result vocabulary and
   update public contract compatibility deliberately.
5. Update docs and focused regression tests.
6. Run Cloudflare-focused verification and final review.

## Verification

Passed:

- `pnpm --dir apps/cloudflare typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-state-store-wake-backoff.test.ts apps/cloudflare/test/index-backpressure.test.ts`
- `pnpm exec vitest run --config vitest.config.ts --no-coverage packages/hosted-execution/test/hosted-runtime-control.test.ts`
- `MURPH_VERIFY_STEP_PARALLEL=0 bash scripts/workspace-verify.sh test:diff apps/cloudflare/src/user-runner.ts apps/cloudflare/src/user-runner/runner-state-store.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/user-runner-alarm.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/runner-state-store-wake-backoff.test.ts apps/cloudflare/test/index-backpressure.test.ts packages/hosted-execution/src/runtime-control.ts packages/hosted-execution/src/parsers/runtime-control.ts packages/hosted-execution/test/hosted-runtime-control.test.ts apps/web/test/hosted-execution-handoff.test.ts apps/web/test/hosted-mailbox-lag-sweeper.test.ts apps/web/test/hosted-onboarding-webhook-workflows.test.ts agent-docs/references/hosted-runtime-protocol.md agent-docs/exec-plans/active/2026-05-14-hosted-runner-demand-reconciliation.md`

Audits:

- `simplify`: findings fixed.
- `security-privacy-review`: findings fixed.
- `coverage-write`: added alarm reconciliation proof.
- `task-finish-review`: no findings.

Status: completed
Updated: 2026-05-15
Completed: 2026-05-15
