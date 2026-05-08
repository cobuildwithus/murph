# Browser-vault refresh scheduling and preemption cleanup

Status: active
Created: 2026-05-09
Updated: 2026-05-09

## Goal

- Preserve uncheckpointed warm hosted runner state when optional detached browser-vault refresh work is preempted by foreground work or aborts/fails.
- Keep the browser-vault refresh schedule result truthful now that scheduling only queues a continuation and never starts immediately.

## Success criteria

- Foreground preemption aborts the optional browser-vault refresh without destroying/stopping the warm runner container.
- Browser-vault refresh abort/failure clears refresh authority/proxy state but does not stop the warm runner unless fail-closed outbound proxy expiry fails.
- Browser-vault refresh schedule responses expose `scheduled: true` instead of the misleading `immediateRefreshStarted`.
- The coordinator no longer accepts unused alarm-sync dependencies.
- Focused Cloudflare runner tests cover both coordinator preemption and container refresh abort behavior.

## Scope

- In scope:
- `apps/cloudflare` browser-vault refresh coordinator, runner container refresh lifecycle, worker route response shape, hosted-control client parser, and focused tests.
- Out of scope:
- Browser-vault replica schema, web session APIs, workspace checkpoint format, and unrelated hosted-local or hosted-web work already dirty in the checkout.

## Constraints

- Technical constraints:
- Optional browser-vault refresh must never intentionally destroy live warm state.
- Foreground invocation and pending nudge preemption must still abort the detached refresh promptly.
- Fail closed only when outbound proxy authority cannot be expired.
- The container RPC payload for browser-vault refresh must stay JSON-serializable: no `AbortSignal` or other live process objects cross the Cloudflare Container boundary.
- Product/process constraints:
- Preserve unrelated working-tree edits and active ledger rows.
- Do not expose sensitive identifiers in logs, tests, or handoff.

## Risks and mitigations

1. Risk:
   Refresh authority remains valid after an aborted optional refresh.
   Mitigation:
   Keep explicit outbound proxy expiry in the refresh finally path and stop warm state only if expiry fails.
2. Risk:
   Foreground work races with refresh cleanup.
   Mitigation:
   Coordinator abort remains synchronous and foreground drain still waits on the tracked refresh promise.

## Tasks

1. Inspect current coordinator/container lifecycle and existing regression tests.
2. Remove active-container destroy from browser-vault refresh foreground preemption.
3. Change browser-vault refresh finally behavior to keep warm state after abort/failure when proxy expiry succeeds.
4. Update focused tests to assert preemption aborts without destruction and abort/failure does not stop warm runner.
5. Rename the browser-vault refresh schedule result from `immediateRefreshStarted` to `scheduled` and remove unused coordinator dependency injection.
6. Run focused verification, required audits, typecheck, and close the plan.

## Decisions

- Browser-vault refresh follows a "never kill live state" rule except when fail-closed outbound proxy cleanup fails.
- Browser-vault refresh cancellation is a DO/wrapper concern: the wrapper may race the local wait on an `AbortSignal`, but `HostedExecutionContainerBrowserVaultRefreshRequest` and the container-side invocation path do not accept or consume `signal`.
- Browser-vault refresh scheduling returns `scheduled: true`; immediate-start reporting is intentionally not part of the new contract.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test -- browser-vault-refresh-coordinator runner-container user-runner-alarm`
- `pnpm test:diff apps/cloudflare/src/browser-vault-refresh/coordinator.ts apps/cloudflare/src/user-runner.ts apps/cloudflare/src/worker-routes/shared.ts apps/cloudflare/src/index.ts apps/cloudflare/src/runner-container.ts apps/cloudflare/test/browser-vault-refresh-coordinator.test.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/runner-container.test.ts apps/cloudflare/test/user-runner-alarm.test.ts packages/cloudflare-hosted-control/src/client.ts packages/cloudflare-hosted-control/test/client.test.ts apps/web/test/browser-vault-session-route.test.ts`
- `pnpm typecheck`
- Expected outcomes:
- Focused and diff-aware Cloudflare tests pass.
- Typecheck passes or any unrelated pre-existing blocker is identified with evidence.
