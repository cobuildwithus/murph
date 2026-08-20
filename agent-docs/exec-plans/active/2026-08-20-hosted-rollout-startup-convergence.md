# Hosted rollout startup convergence

## Goal

Prevent a slow Cloudflare container cold start during an immediate image rollout
from being destroyed and restarted on every short runtime-control readiness
budget.

Success criteria:

- A caller timeout while a newly issued container start is still within the
  configured readiness window leaves the platform start intact.
- A later readiness retry can join that same start and proceed once healthy.
- Truly failed, stale, or unhealthy warm containers keep the existing bounded
  restart behavior.
- Production's default readiness window covers the observed rollout cold-start
  duration with bounded headroom.
- Focused tests, Cloudflare typecheck, exact-head CI, and ReviewGPT all pass.

## Constraints

- Do not deploy, mutate production state, or activate automated remediation.
- Keep the existing short runtime-control response budget and retry cadence.
- Do not weaken fail-closed handling for crashed, stale, poisoned, or
  architecture-mismatched containers.
- Do not expose production rows, member identifiers, credentials, local account
  names, or home paths in repository artifacts.
- The older hosted-runner destroy-timeout plan owns bounded destroy settlement;
  this plan changes only the pre-destroy classification of a still-progressing
  cold start.

## Product UX

This is a Product UX Patch. The affected people are hosted users whose runner
cold-starts during a container rollout and ordinary hosted users whose container
is genuinely unhealthy. The walkthrough is ready only if the first group
converges without restart thrash while the second group retains bounded recovery.

## Approach

1. Add a focused regression that reproduces a cold start spanning multiple
   caller readiness budgets.
2. Preserve an aborted start wait when Cloudflare still reports a recent
   running/healthy state, including when the lifecycle start hook has fired but
   readiness has not yet completed and when startup transport returns before
   the caller timeout.
3. Rejoin that start on later readiness calls and retain the existing destroy
   path after the configured readiness window or for fatal and previously-ready
   unhealthy shells.
4. Raise and document the canonical default readiness window to 90 seconds,
   covering the observed roughly one-minute rollout start with bounded headroom.
5. Run focused proof, commit and push the candidate, then resolve the required
   ReviewGPT and exact-head CI gates without merging or deploying.

## State

Active. Initial exact-head CI passed. Preliminary and final ReviewGPT found two
connected high gaps in lifecycle ordering and immediate startup-transport
handling; both findings are accepted, reproduced, and remediated locally. A
fresh exact-head review and CI remain.

## Evidence

- The production error burst included real `RunnerContainer` failures after the
  deploy smoke passed, dominated by port-not-listening and aborted-start errors.
- The successful deploy smoke required roughly one minute to converge.
- Runtime-control readiness is capped to about 8 seconds by default and 15
  seconds at most; the existing 20-second runner readiness default cannot widen
  that caller path.
- The pinned Cloudflare containers SDK issues `container.start()` before its
  abortable wait and cancellation stops the wait rather than the platform start.
- A focused regression now proves one cold start survives two expired caller
  budgets and an intervening lifecycle start observation, then becomes healthy
  at 58 seconds without any destroy or second start.
- A companion regression proves an unobserved start older than 90 seconds still
  enters bounded cleanup.
- ReviewGPT's preliminary specialist pass found that the original regression
  did not fire the lifecycle start hook between caller budgets. The accepted
  remediation retains an explicit pending-start deadline across that hook.
- ReviewGPT's final first pass found that an immediate startup HTTP 503 still
  bypassed the timeout-only grace. The accepted remediation treats recent
  starts that have never passed health readiness as pending for non-fatal
  startup failures, while previously ready, stale, stopped, poisoned, and
  version-mismatched shells retain cleanup.
- The container regression now keeps the same start across a caller timeout,
  lifecycle start observation, and an immediate non-JSON HTTP 503 whose caller
  signal remains active, then reaches health at 58 seconds with zero destroys.
- A UserRunner owner regression proves an ordinary retry of the same accepted
  orchestration reaches runtime acceptance after the container becomes ready.
- Focused Cloudflare verification passes after remediation: 415 tests across
  five files plus package typecheck.

## Working Set

- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/src/hosted-execution-worker-env.ts`
- `apps/cloudflare/scripts/deploy-automation/environment.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- `apps/cloudflare/test/env.test.ts`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `apps/cloudflare/DEPLOY.md`
